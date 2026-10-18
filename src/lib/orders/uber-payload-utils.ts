// Helpers ported from mediasis-cr-order-app (checkout actions + lib/utils) so a
// manual re-dispatch rebuilds the Uber delivery with the same fidelity as the
// original one, using the order's stored checkout_payload / uber_context.
// Types are structural ("Like") because the payload arrives as raw JSONB.

export type CartChoiceLike = {
  choice?: string;
  quantity?: number | null;
  price?: number | null;
};

export type CartSelectionOptionLike = {
  name?: string;
  option_kind?: string | null;
  choice?: CartChoiceLike | null;
};

export type CartCheckboxOptionLike = {
  name?: string;
  option_kind?: string | null;
  choices?: CartChoiceLike[] | null;
};

export type CartOptionSetLike = {
  quantity?: number | null;
  selection?: CartSelectionOptionLike[] | null;
  checkbox?: CartCheckboxOptionLike[] | null;
};

export type CartProductLike = {
  product: {
    id?: string;
    name?: string | null;
    price?: number | null;
    variantName?: string | null;
  };
  options: CartOptionSetLike;
};

export type UberContextLike = {
  domain?: string;
  business_name?: string;
  user_location_label?: string | null;
  business_location?: {
    value?: string;
    label?: string;
    text_address?: string | null;
    phone_number?: string | null;
    lat?: number;
    lng?: number;
  } | null;
  cart_products?: CartProductLike[] | null;
};

export type CheckoutPayloadLike = {
  name?: string;
  phone?: string;
  address_type?: string;
  address_unit?: string;
  address_building?: string;
  options?: unknown[];
  delivery_method_options?: unknown[];
  uber_context?: UberContextLike;
};

// ── Line totals (options-inclusive), ported from lib/utils.ts ───────────────

const choiceTotal = (choice?: CartChoiceLike | null) => {
  if (!choice) return 0;
  const qty = choice.quantity ?? 1;
  const price = choice.price ?? 0;
  return price * qty;
};

const optionKind = (kind?: string | null) => kind ?? "general";

const optionTotals = (options: CartOptionSetLike, productQuantity = 1) => {
  const normalizedProductQuantity = Math.max(1, Number(productQuantity ?? 1));

  const checkboxTotal = (options.checkbox ?? []).reduce((sum, opt) => {
    const choicesSum = (opt.choices ?? []).reduce(
      (cSum, c) => cSum + choiceTotal(c),
      0
    );
    const multiplier =
      optionKind(opt.option_kind) === "extra" ? 1 : normalizedProductQuantity;
    return sum + choicesSum * multiplier;
  }, 0);

  const selectionTotal = (options.selection ?? []).reduce((sum, opt) => {
    const multiplier =
      optionKind(opt.option_kind) === "extra" ? 1 : normalizedProductQuantity;
    return sum + choiceTotal(opt?.choice) * multiplier;
  }, 0);

  return { checkboxTotal, selectionTotal };
};

export const getCartLineTotals = ({
  productPrice,
  productQuantity = 1,
  options,
}: {
  productPrice?: number | null;
  productQuantity?: number | null;
  options: CartOptionSetLike;
}) => {
  const normalizedProductPrice = Number(productPrice ?? 0);
  const normalizedProductQuantity = Math.max(1, Number(productQuantity ?? 1));
  const { checkboxTotal, selectionTotal } = optionTotals(
    options,
    normalizedProductQuantity
  );
  const productTotal = normalizedProductPrice * normalizedProductQuantity;
  const extrasTotal = checkboxTotal + selectionTotal;
  const totalPrice = productTotal + extrasTotal;

  return { productTotal, extrasTotal, totalPrice, productQuantity: normalizedProductQuantity };
};

// ── Manifest item name, ported from checkout actions ────────────────────────

export function buildUberManifestItemName(item: CartProductLike): string {
  const baseName = item.product.name?.trim() || "Producto";
  const variantName = item.product.variantName?.trim();

  const selectionDetails = (item.options.selection ?? [])
    .filter((opt) => opt?.name && opt?.choice?.choice)
    .map((opt) => {
      const quantity =
        typeof opt.choice?.quantity === "number" && opt.choice.quantity > 0
          ? ` (${opt.choice.quantity})`
          : "";
      return `${opt.name}: ${opt.choice?.choice}${quantity}`;
    });

  const checkboxDetails = (item.options.checkbox ?? []).flatMap((opt) =>
    (opt.choices ?? [])
      .filter((choice) => opt?.name && choice?.choice)
      .map((choice) => {
        const quantity =
          typeof choice.quantity === "number" && choice.quantity > 0
            ? ` (${choice.quantity})`
            : "";
        return `${opt.name}: ${choice.choice}${quantity}`;
      })
  );

  const selectedOptions = [...selectionDetails, ...checkboxDetails];
  const nameWithVariant = variantName ? `${baseName} - ${variantName}` : baseName;

  return selectedOptions.length > 0
    ? `${nameWithVariant} | ${selectedOptions.join(", ")}`
    : nameWithVariant;
}

// ── Dropoff notes, ported from checkout actions ─────────────────────────────

const UBER_NOTE_MAX_LENGTH = 280;
const UBER_DROPOFF_NOTES_FALLBACK =
  "Entregar en la ubicación indicada por el cliente.";

export const UBER_PICKUP_NOTES =
  "Por favor tomar una foto del pedido al recogerlo y confirmar el nombre y numero con el personal de tienda.";

export function truncateUberNote(value: string) {
  return value.trim().slice(0, UBER_NOTE_MAX_LENGTH);
}

type NoteOptionLike = {
  type?: string;
  question?: string;
  value?: unknown;
};

export function buildUberDropoffNotes(values: CheckoutPayloadLike): string {
  const lines: string[] = [];
  const addressLines = [
    values.address_type ? `Tipo de edificio: ${values.address_type}` : null,
    values.address_unit?.trim() ? `Unidad: ${values.address_unit.trim()}` : null,
    values.address_building?.trim()
      ? `Edificio: ${values.address_building.trim()}`
      : null,
  ].filter((line): line is string => Boolean(line));

  if (addressLines.length > 0) {
    lines.push(addressLines.join(" | "));
  }

  const appendOptionLines = (
    sectionTitle: string,
    optionsArray: Array<NoteOptionLike | undefined>
  ) => {
    const sectionLines: string[] = [];

    optionsArray.forEach((option) => {
      if (!option) return;

      const question = option.question?.trim();
      const value = option.value;
      if (!question || value === undefined || value === null) return;

      if (
        option.type === "select" &&
        typeof value === "object" &&
        value !== null &&
        "choice" in value
      ) {
        const selected =
          typeof (value as { choice?: unknown }).choice === "string"
            ? ((value as { choice: string }).choice ?? "").trim()
            : "";
        if (!selected) return;

        const quantityValue = (value as { quantity?: unknown }).quantity;
        const quantity =
          typeof quantityValue === "number" && quantityValue > 0
            ? ` (${quantityValue})`
            : "";

        sectionLines.push(`- ${question}: ${selected}${quantity}`);
        return;
      }

      if (option.type === "checkbox" && Array.isArray(value) && value.length > 0) {
        const selectedChoices = value
          .map((choice) => {
            if (!choice || typeof choice !== "object" || !("choice" in choice)) {
              return null;
            }

            const label =
              typeof (choice as { choice?: unknown }).choice === "string"
                ? ((choice as { choice: string }).choice ?? "").trim()
                : "";
            if (!label) return null;

            const quantityValue = (choice as { quantity?: unknown }).quantity;
            const quantity =
              typeof quantityValue === "number" && quantityValue > 0
                ? ` (${quantityValue})`
                : "";

            return `${label}${quantity}`;
          })
          .filter(Boolean);

        if (selectedChoices.length > 0) {
          sectionLines.push(`- ${question}: ${selectedChoices.join(", ")}`);
        }
      }
    });

    if (sectionLines.length > 0) {
      lines.push(sectionTitle);
      lines.push(...sectionLines);
    }
  };

  appendOptionLines(
    "Opciones del checkout:",
    (values.options as Array<NoteOptionLike | undefined> | undefined) ?? []
  );

  appendOptionLines(
    "Opciones del metodo de entrega:",
    (values.delivery_method_options as Array<NoteOptionLike | undefined> | undefined) ??
      []
  );

  return truncateUberNote(
    lines.length > 0 ? lines.join("\n") : UBER_DROPOFF_NOTES_FALLBACK
  );
}

import { notFound } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { OptionGroupForm } from "@/components/option-groups-page/OptionGroupForm";
import { GroupProductsSection } from "@/components/option-groups-page/GroupProductsSection";
import {
  getOptionGroupById,
  getBusinessLocations,
  getBusinessProducts,
  getGroupAttachedProducts,
  updateOptionGroup,
  deleteOptionGroup,
} from "../actions";
import { GroupOptionInput, OptionGroupInput } from "@/lib/FormSchemas/optionGroupSchema";
import { DeleteGroupButton } from "./DeleteGroupButton";

type Props = {
  params: Promise<{ group_id: string }>;
};

export default async function EditOptionGroupPage({ params }: Props) {
  const { group_id } = await params;

  const [groupResult, locResult, productsResult, attachedResult] = await Promise.all([
    getOptionGroupById(group_id),
    getBusinessLocations(),
    getBusinessProducts(),
    getGroupAttachedProducts(group_id),
  ]);

  if (!groupResult.success || !groupResult.data) notFound();

  const group = groupResult.data;
  const locations = locResult.success ? (locResult.data ?? []) : [];
  const allProducts = productsResult.success ? (productsResult.data ?? []) : [];
  const attachedProducts = attachedResult.success ? (attachedResult.data ?? []) : [];

  type RawChoice = {
    product_option_choice_id: string;
    name: string;
    price: number;
    scope: string;
    sequence: number;
    product_option_choice_locations: { business_location_id: string }[];
  };
  type RawOption = {
    product_option_id?: string;
    name: string;
    type: string;
    required: boolean;
    enable_quantity?: boolean;
    validation?: unknown;
    product_option_choices?: RawChoice[];
  };

  const rawOptions = ((group.product_options ?? []) as unknown as RawOption[]);

  const defaultValues: Partial<OptionGroupInput> = {
    name: group.name,
    kind: group.kind as "general" | "side" | "extra",
    options: rawOptions.map((opt) => ({
      product_option_id: opt.product_option_id,
      name: opt.name,
      type: opt.type as "text" | "number" | "date" | "checkbox" | "selection" | "media",
      required: opt.required,
      enable_quantity: opt.enable_quantity ?? false,
      validation: opt.validation as GroupOptionInput["validation"] ?? undefined,
      choices: (opt.product_option_choices ?? []).map((c) => ({
        product_option_choice_id: c.product_option_choice_id,
        name: c.name,
        price: c.price,
        scope: c.scope as "all" | "specific",
        sequence: c.sequence,
        location_ids: c.product_option_choice_locations.map((l) => l.business_location_id),
      })),
    })),
  };

  async function handleUpdate(values: OptionGroupInput) {
    "use server";
    return updateOptionGroup(group_id, values);
  }

  const isSideOrExtra = group.kind === "side" || group.kind === "extra";

  return (
    <div className="px-4 mb-32">
      <div className="flex items-center justify-between gap-4">
        <BackButton label="Acompañamientos / Extras" />
        <DeleteGroupButton groupId={group_id} />
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-xl space-y-8">
          <h1 className="text-xl font-semibold">Editar grupo</h1>

          <OptionGroupForm
            defaultValues={defaultValues}
            locations={locations}
            onSubmit={handleUpdate}
            submitLabel="Guardar cambios"
            backUrl="/admin/products/product-option-groups"
          />

          {isSideOrExtra && (
            <div className="border-t pt-6">
              <GroupProductsSection
                groupId={group_id}
                kind={group.kind as "side" | "extra"}
                allProducts={allProducts}
                initialAttached={attachedProducts as Parameters<typeof GroupProductsSection>[0]["initialAttached"]}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

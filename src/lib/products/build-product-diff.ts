import { ProductEditInput } from "@/lib/FormSchemas/productEditSchema";
import { z } from "zod";
import { AttachedGroupSequenceSchema } from "@/lib/FormSchemas/productEditSchema";

type CategoryLike = {
  value?: string | null;
  product_category_id?: string | null;
};

type DeliveryMethodLike = {
  value?: string | null;
  delivery_method_id?: string | null;
};

type BusinessLocationLike = {
  value?: string | null;
  business_location_id?: string | null;
};

type VariantInput = NonNullable<ProductEditInput["variants"]>[number];

type ExistingVariant = VariantInput & {
  product_variant_id?: string | null;
};

type ExistingProductForEdit = ProductEditInput & {
  product_id: string;
  categories?: CategoryLike[];
  delivery_methods?: DeliveryMethodLike[];
  variants?: ExistingVariant[];
  attached_side_extra_groups?: z.infer<typeof AttachedGroupSequenceSchema>[];
};

type ArrayDiff<T> = {
  toInsert: T[];
  toDelete: T[];
};

type VariantInsertDiff = Omit<VariantInput, "product_variant_id"> & {
  product_id: string;
};

type VariantUpdateDiff = VariantInput & {
  product_variant_id: string;
};

type VariantDiff = {
  toInsert: VariantInsertDiff[];
  toUpdate: VariantUpdateDiff[];
  toDelete: string[];
};

type VariantLocationDiff = Record<string, ArrayDiff<string>>;

type ImagesDiff = {
  product: ArrayDiff<string>;
  variants: Record<string, ArrayDiff<string>>;
};

type AttachedGroupSequencesDiff = {
  toUpdate: { product_option_group_id: string; sequence: number }[];
};

type ProductUpdatePayload = {
  product_id: string;
  name: string;
  visibility: boolean;
  type: string;
  sku?: string | null;
  weight?: number | null;
  price: number;
  original_price?: number | null;
  description?: string | null;
  options?: ProductEditInput["options"];
  images?: string[];
};

export type ProductDiff = {
  product: { toUpdate: ProductUpdatePayload };
  categories: ArrayDiff<string>;
  deliveryMethods: ArrayDiff<string>;
  variants: VariantDiff;
  variantLocations: VariantLocationDiff;
  images: ImagesDiff;
  attachedGroupSequences: AttachedGroupSequencesDiff;
};

export function buildProductDiff(
  existing: ExistingProductForEdit,
  desired: ProductEditInput,
): ProductDiff {
  const normalizedVariants = normalizeVariants(desired.variants ?? []);
  const existingVariants = existing.variants ?? [];

  const productDiff: ProductDiff = {
    product: {
      toUpdate: buildProductUpdatePayload(existing.product_id, desired),
    },
    categories: diffIdCollections(
      existing.categories,
      desired.categories ?? [],
      getCategoryId,
      getCategoryId,
    ),
    deliveryMethods: diffIdCollections(
      existing.delivery_methods,
      desired.delivery_methods ?? [],
      getDeliveryMethodId,
      getDeliveryMethodId,
    ),
    variants: buildVariantDiff(existing.product_id, existingVariants, normalizedVariants),
    variantLocations: buildVariantLocationsDiff(
      existingVariants,
      normalizedVariants,
      existing.business_locations,
      desired.business_locations,
    ),
    images: buildImagesDiff(existing, existingVariants, normalizedVariants, desired),
    attachedGroupSequences: buildAttachedGroupSequencesDiff(
      desired.attached_group_sequences ?? [],
    ),
  };

  return productDiff;
}

function buildProductUpdatePayload(
  productId: string,
  desired: ProductEditInput,
): ProductUpdatePayload {
  return {
    product_id: productId,
    name: desired.name,
    visibility: desired.visibility,
    type: desired.type,
    sku: desired.sku ?? null,
    weight: desired.weight ?? null,
    price: desired.price,
    original_price: desired.original_price ?? null,
    description: desired.description ?? null,
    options: desired.options ?? [],
    images: desired.images ?? [],
  };
}

function normalizeVariants(variants: VariantInput[]): VariantInput[] {
  return variants.map((variant, index) => ({
    ...variant,
    sequence: index + 1,
  }));
}

function buildVariantDiff(
  productId: string,
  existing: ExistingVariant[],
  desired: VariantInput[],
): VariantDiff {
  const existingIds = new Set(
    existing.map((variant) => variant.product_variant_id).filter(Boolean) as string[],
  );
  const desiredIds = new Set(
    desired.map((variant) => variant.product_variant_id).filter(Boolean) as string[],
  );

  const toInsert: VariantInsertDiff[] = [];
  const toUpdate: VariantUpdateDiff[] = [];

  desired.forEach((variant) => {
    if (variant.product_variant_id) {
      toUpdate.push({
        ...variant,
        product_variant_id: variant.product_variant_id,
      });
      return;
    }
    const { product_variant_id: _unused, ...rest } = variant;
    toInsert.push({
      ...rest,
      product_id: productId,
    });
  });

  const toDelete = [...existingIds].filter((id) => !desiredIds.has(id));

  return {
    toInsert,
    toUpdate,
    toDelete,
  };
}

function buildVariantLocationsDiff(
  existing: ExistingVariant[],
  desired: VariantInput[],
  existingProductLocations: BusinessLocationLike[] | undefined,
  desiredProductLocations: BusinessLocationLike[] | undefined,
): VariantLocationDiff {
  const result: VariantLocationDiff = {};
  const defaultDiff = diffIdCollections(
    existingProductLocations,
    desiredProductLocations,
    getLocationId,
    getLocationId,
  );
  if (defaultDiff.toInsert.length || defaultDiff.toDelete.length) {
    result.default = defaultDiff;
  }
  const desiredById = new Map(
    desired
      .filter((variant): variant is VariantInput & { product_variant_id: string } =>
        Boolean(variant.product_variant_id),
      )
      .map((variant) => [variant.product_variant_id, variant]),
  );

  existing.forEach((variant) => {
    const variantId = variant.product_variant_id;
    if (!variantId) return;

    const desiredVariant = desiredById.get(variantId);
    if (!desiredVariant) {
      const removed = extractIds(variant.business_locations, getLocationId);
      if (removed.length) {
        result[variantId] = { toInsert: [], toDelete: removed };
      }
      return;
    }

    const diff = diffIdCollections(
      variant.business_locations,
      desiredVariant.business_locations,
      getLocationId,
      getLocationId,
    );
    if (diff.toInsert.length || diff.toDelete.length) {
      result[variantId] = diff;
    }
  });

  return result;
}

function buildImagesDiff(
  existingProduct: ExistingProductForEdit,
  existingVariants: ExistingVariant[],
  desiredVariants: VariantInput[],
  desiredProduct: ProductEditInput,
): ImagesDiff {
  const productImagesDiff = diffPrimitiveArrays(
    existingProduct.images ?? [],
    desiredProduct.images ?? [],
  );

  const desiredVariantsById = new Map(
    desiredVariants
      .filter((variant): variant is VariantInput & { product_variant_id: string } =>
        Boolean(variant.product_variant_id),
      )
      .map((variant) => [variant.product_variant_id, variant]),
  );

  const variantImageDiffs: Record<string, ArrayDiff<string>> = {};

  existingVariants.forEach((variant) => {
    const variantId = variant.product_variant_id;

    if (!variantId) {
      return;
    }

    const desiredVariant = desiredVariantsById.get(variantId);
    if (!desiredVariant) {
      const removal = diffPrimitiveArrays(variant.images ?? [], []);
      if (removal.toDelete.length) {
        variantImageDiffs[variantId] = removal;
      }
      return;
    }

    const diff = diffPrimitiveArrays(variant.images ?? [], desiredVariant.images ?? []);
    if (diff.toInsert.length || diff.toDelete.length) {
      variantImageDiffs[variantId] = diff;
    }
  });

  return {
    product: productImagesDiff,
    variants: variantImageDiffs,
  };
}

function diffPrimitiveArrays(valuesA: string[], valuesB: string[]): ArrayDiff<string> {
  const setA = new Set(valuesA.filter(Boolean));
  const setB = new Set(valuesB.filter(Boolean));
  return {
    toInsert: [...setB].filter((value) => !setA.has(value)),
    toDelete: [...setA].filter((value) => !setB.has(value)),
  };
}

function diffIdCollections<TExisting, TDesired>(
  existing: TExisting[] | undefined,
  desired: TDesired[] | undefined,
  existingGetter: (item: TExisting) => string | null | undefined,
  desiredGetter: (item: TDesired) => string | null | undefined,
): ArrayDiff<string> {
  const existingSet = buildIdSet(existing, existingGetter);
  const desiredSet = buildIdSet(desired, desiredGetter);
  return {
    toInsert: [...desiredSet].filter((id) => !existingSet.has(id)),
    toDelete: [...existingSet].filter((id) => !desiredSet.has(id)),
  };
}

function buildIdSet<T>(
  items: T[] | undefined,
  getter: (item: T) => string | null | undefined,
): Set<string> {
  const set = new Set<string>();
  (items ?? []).forEach((item) => {
    const id = getter(item);
    if (id) {
      set.add(id);
    }
  });
  return set;
}

function extractIds<T>(
  items: T[] | undefined,
  getter: (item: T) => string | null | undefined,
): string[] {
  return (items ?? [])
    .map((item) => getter(item))
    .filter((value): value is string => Boolean(value));
}

function getCategoryId(item: CategoryLike): string | null {
  return item.value ?? item.product_category_id ?? null;
}

function getDeliveryMethodId(item: DeliveryMethodLike): string | null {
  return item.value ?? item.delivery_method_id ?? null;
}

function getLocationId(item: BusinessLocationLike): string | null {
  return item.value ?? item.business_location_id ?? null;
}

function buildAttachedGroupSequencesDiff(
  desired: z.infer<typeof AttachedGroupSequenceSchema>[],
): AttachedGroupSequencesDiff {
  return {
    toUpdate: desired.map((g) => ({
      product_option_group_id: g.product_option_group_id,
      sequence: g.sequence,
    })),
  };
}

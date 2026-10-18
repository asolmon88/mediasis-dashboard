import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const FULL_PRODUCTS_PERMISSION = "products.manage.full";

export async function requireFullProductsAccess() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId || !hasDashboardPermission(context, FULL_PRODUCTS_PERMISSION)) {
    return { success: false as const, message: "No tenés permiso para administrar productos." };
  }

  return {
    success: true as const,
    context,
    businessId: context.activeBusinessId,
    allowedLocationIds: new Set(context.locations.map((location) => location.business_location_id)),
    canManageAllLocations: context.mode === "legacy" || context.allLocations,
    admin: createAdminClient(),
  };
}

export async function requireProductAccess(productId: string) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;

  const { data: product } = await authorized.admin
    .schema("mediasis")
    .from("product")
    .select("product_id")
    .eq("product_id", productId)
    .eq("business", authorized.businessId)
    .maybeSingle();

  if (!product) return { success: false as const, message: "Producto no encontrado." };
  return { ...authorized, product };
}

export function validateLocationSelection(
  locationIds: string[],
  authorized: Awaited<ReturnType<typeof requireFullProductsAccess>>,
) {
  if (!authorized.success) return authorized;
  if (authorized.canManageAllLocations) return { success: true as const };
  const invalid = locationIds.find((id) => !authorized.allowedLocationIds.has(id));
  return invalid
    ? { success: false as const, message: "No tenés acceso a una de las ubicaciones seleccionadas." }
    : { success: true as const };
}

type LocationValue = { label?: string; value?: string; business_location_id?: string };
type LocationScopedChoice = { name?: string; scope?: "all" | "specific"; location_ids?: string[] };
type LocationScopedOption = { name?: string; choices?: LocationScopedChoice[] };
type LocationScopedVariant = { product_variant_id?: string; business_locations?: LocationValue[] };
type LocationScopedProduct = {
  business_locations?: LocationValue[];
  variants?: LocationScopedVariant[];
  options?: LocationScopedOption[];
  available_everywhere?: boolean;
  [key: string]: unknown;
};

const locationId = (value: LocationValue) => value.value ?? value.business_location_id ?? "";

/** Hide inaccessible location identifiers before product data reaches a Clerk client. */
export function sanitizeProductLocationScope<T extends LocationScopedProduct>(
  product: T,
  allowedLocationIds: Set<string>,
  canManageAllLocations: boolean,
): T {
  if (canManageAllLocations) return { ...product, available_everywhere: (product.business_locations ?? []).length === 0 };
  return {
    ...product,
    available_everywhere: (product.business_locations ?? []).length === 0,
    business_locations: (product.business_locations ?? []).filter((value) => allowedLocationIds.has(locationId(value))),
    variants: (product.variants ?? []).map((variant) => ({
      ...variant,
      business_locations: (variant.business_locations ?? []).filter((value) => allowedLocationIds.has(locationId(value))),
    })),
    options: (product.options ?? []).map((option) => ({
      ...option,
      choices: (option.choices ?? []).map((choice) => ({
        ...choice,
        location_ids: (choice.location_ids ?? []).filter((id) => allowedLocationIds.has(id)),
      })),
    })),
  } as T;
}

/**
 * Restricted saves are merged with inaccessible assignments. The browser never
 * receives those identifiers, but it also cannot erase them by omission.
 */
export function mergeProtectedProductLocationScope<T extends LocationScopedProduct>(
  existing: T,
  desired: T,
  allowedLocationIds: Set<string>,
): T {
  const preserveLocations = (current: LocationValue[] = [], next: LocationValue[] = []) => {
    if (current.length === 0) return [];
    return [
      ...current.filter((value) => !allowedLocationIds.has(locationId(value))),
      ...next.filter((value) => allowedLocationIds.has(locationId(value))),
    ];
  };
  const existingVariants = new Map((existing.variants ?? []).map((variant) => [variant.product_variant_id, variant]));
  const existingOptions = new Map((existing.options ?? []).map((option) => [option.name, option]));

  return {
    ...desired,
    business_locations: preserveLocations(existing.business_locations, desired.business_locations),
    variants: (desired.variants ?? []).map((variant) => ({
      ...variant,
      business_locations: preserveLocations(
        existingVariants.get(variant.product_variant_id)?.business_locations,
        variant.business_locations,
      ),
    })),
    options: (desired.options ?? []).map((option) => {
      const currentOption = existingOptions.get(option.name);
      const currentChoices = new Map((currentOption?.choices ?? []).map((choice) => [choice.name, choice]));
      return {
        ...option,
        choices: (option.choices ?? []).map((choice) => {
          const currentChoice = currentChoices.get(choice.name);
          if (currentChoice?.scope === "all") return { ...choice, scope: "all" as const, location_ids: [] };
          return {
            ...choice,
            scope: "specific" as const,
            location_ids: [
              ...(currentChoice?.location_ids ?? []).filter((id) => !allowedLocationIds.has(id)),
              ...(choice.location_ids ?? []).filter((id) => allowedLocationIds.has(id)),
            ],
          };
        }),
      };
    }),
  } as T;
}

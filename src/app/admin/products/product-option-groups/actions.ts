"use server";

import { OptionGroupSchema, OptionGroupInput } from "@/lib/FormSchemas/optionGroupSchema";
import { revalidatePath } from "next/cache";
import { requireFullProductsAccess, validateLocationSelection } from "@/lib/dashboard/product-authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getBusinessOptionGroups() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return { ...authorized, data: null };
  const { data, error } = await authorized.admin
    .schema("mediasis")
    .rpc("get_product_option_groups_for_dashboard", { p_business_id: authorized.businessId });
  if (error) return { success: false as const, message: error.message, data: null };
  return { success: true as const, data: data as OptionGroupRow[] };
}

export async function getOptionGroupById(groupId: string) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return { ...authorized, data: null };
  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("product_option_groups")
    .select(`
      product_option_group_id,
      name,
      kind,
      active,
      product_options (
        product_option_id,
        name,
        type,
        required,
        enable_quantity,
        validation,
        active,
        product_option_choices (
          product_option_choice_id,
          name,
          price,
          scope,
          sequence,
          active,
          product_option_choice_locations ( business_location_id )
        )
      )
  `)
    .eq("product_option_group_id", groupId)
    .eq("business_id", authorized.businessId)
    .single();
  if (error) return { success: false as const, message: error.message, data: null };
  if (!authorized.canManageAllLocations && data) {
    return {
      success: true as const,
      data: {
        ...data,
        product_options: (data.product_options ?? []).map((option) => ({
          ...option,
          product_option_choices: (option.product_option_choices ?? []).map((choice) => ({
            ...choice,
            product_option_choice_locations: (choice.product_option_choice_locations ?? []).filter(
              (location) => authorized.allowedLocationIds.has(location.business_location_id),
            ),
          })),
        })),
      },
    };
  }
  return { success: true as const, data };
}

export async function getBusinessLocations() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return { ...authorized, data: null };
  return { success: true as const, data: authorized.context.locations };
}

export async function getBusinessProducts() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return { ...authorized, data: null };
  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("product")
    .select("product_id, name")
    .eq("business", authorized.businessId)
    .eq("visibility", true)
    .order("name");
  if (error) return { success: false as const, message: error.message, data: null };
  return { success: true as const, data };
}

export async function getGroupAttachedProducts(groupId: string) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return { ...authorized, data: null };
  const { data: group } = await authorized.admin.schema("mediasis").from("product_option_groups")
    .select("product_option_group_id").eq("product_option_group_id", groupId).eq("business_id", authorized.businessId).maybeSingle();
  if (!group) return { success: false as const, message: "Grupo no encontrado.", data: null };
  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("product_option_group_products")
    .select("product_id, sequence, product!inner(name)")
    .eq("product_option_group_id", groupId)
    .eq("active", true);
  if (error) return { success: false as const, message: error.message, data: null };
  return { success: true as const, data };
}

export async function createOptionGroup(values: OptionGroupInput) {
  const parsed = OptionGroupSchema.safeParse(values);
  if (!parsed.success) return { success: false as const, message: parsed.error.message };

  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const locationIds = (parsed.data.options ?? []).flatMap((option) =>
    (option.choices ?? []).flatMap((choice) => choice.location_ids ?? []));
  const locationValidation = validateLocationSelection(locationIds, authorized);
  if (!locationValidation.success) return locationValidation;
  const supabase = authorized.admin;

  const { data: group, error: groupError } = await supabase
    .schema("mediasis")
    .from("product_option_groups")
    .insert({ business_id: authorized.businessId, name: parsed.data.name, kind: parsed.data.kind })
    .select("product_option_group_id")
    .single();

  if (groupError || !group) return { success: false as const, message: groupError?.message ?? "Error" };

  try {
    await upsertGroupOptions(supabase, group.product_option_group_id, parsed.data.options ?? [], authorized);
  } catch (error) {
    return {
      success: false as const,
      message: error instanceof Error ? error.message : "Error updating group options",
    };
  }

  revalidatePath("/admin/products/product-option-groups");
  return { success: true as const, data: group };
}

export async function updateOptionGroup(groupId: string, values: OptionGroupInput) {
  const parsed = OptionGroupSchema.safeParse(values);
  if (!parsed.success) return { success: false as const, message: parsed.error.message };

  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const locationIds = (parsed.data.options ?? []).flatMap((option) =>
    (option.choices ?? []).flatMap((choice) => choice.location_ids ?? []));
  const locationValidation = validateLocationSelection(locationIds, authorized);
  if (!locationValidation.success) return locationValidation;
  const supabase = authorized.admin;

  const { data: ownedGroup } = await supabase
    .schema("mediasis")
    .from("product_option_groups")
    .select("product_option_group_id")
    .eq("product_option_group_id", groupId)
    .eq("business_id", authorized.businessId)
    .maybeSingle();
  if (!ownedGroup) return { success: false as const, message: "Grupo no encontrado." };

  const { error: groupError } = await supabase
    .schema("mediasis")
    .from("product_option_groups")
    .update({ name: parsed.data.name, kind: parsed.data.kind })
    .eq("product_option_group_id", groupId)
    .eq("business_id", authorized.businessId);

  if (groupError) return { success: false as const, message: groupError.message };

  try {
    await upsertGroupOptions(supabase, groupId, parsed.data.options ?? [], authorized);
  } catch (error) {
    return {
      success: false as const,
      message: error instanceof Error ? error.message : "Error updating group options",
    };
  }

  revalidatePath("/admin/products/product-option-groups");
  revalidatePath(`/admin/products/product-option-groups/${groupId}`);
  return { success: true as const };
}

export async function deleteOptionGroup(groupId: string) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const supabase = authorized.admin;
  const { error } = await supabase
    .schema("mediasis")
    .from("product_option_groups")
    .delete()
    .eq("product_option_group_id", groupId)
    .eq("business_id", authorized.businessId);
  if (error) return { success: false as const, message: error.message };
  revalidatePath("/admin/products/product-option-groups");
  return { success: true as const };
}

export async function attachGroupToProduct(groupId: string, productId: string, sequence: number) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const [{ data: group }, { data: product }] = await Promise.all([
    authorized.admin.schema("mediasis").from("product_option_groups").select("product_option_group_id")
      .eq("product_option_group_id", groupId).eq("business_id", authorized.businessId).maybeSingle(),
    authorized.admin.schema("mediasis").from("product").select("product_id")
      .eq("product_id", productId).eq("business", authorized.businessId).maybeSingle(),
  ]);
  if (!group || !product) return { success: false as const, message: "Recurso no encontrado." };
  const supabase = authorized.admin;
  const { error } = await supabase
    .schema("mediasis")
    .from("product_option_group_products")
    .upsert({ product_option_group_id: groupId, product_id: productId, sequence }, {
      onConflict: "product_option_group_id,product_id",
    });
  if (error) return { success: false as const, message: error.message };
  return { success: true as const };
}

export async function detachGroupFromProduct(groupId: string, productId: string) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const [{ data: group }, { data: product }] = await Promise.all([
    authorized.admin.schema("mediasis").from("product_option_groups").select("product_option_group_id")
      .eq("product_option_group_id", groupId).eq("business_id", authorized.businessId).maybeSingle(),
    authorized.admin.schema("mediasis").from("product").select("product_id")
      .eq("product_id", productId).eq("business", authorized.businessId).maybeSingle(),
  ]);
  if (!group || !product) return { success: false as const, message: "Recurso no encontrado." };
  const supabase = authorized.admin;
  const { error } = await supabase
    .schema("mediasis")
    .from("product_option_group_products")
    .delete()
    .eq("product_option_group_id", groupId)
    .eq("product_id", productId);
  if (error) return { success: false as const, message: error.message };
  return { success: true as const };
}

// ----------------------------------------------------------------
// Internal: upsert options + choices for a group
// ----------------------------------------------------------------
async function upsertGroupOptions(
  supabase: ReturnType<typeof createAdminClient>,
  groupId: string,
  options: OptionGroupInput["options"] & object,
  authorized: Extract<Awaited<ReturnType<typeof requireFullProductsAccess>>, { success: true }>,
) {
  const submittedOptions = options ?? [];
  const { data: existingOptions, error: existingOptionsError } = await supabase
    .schema("mediasis")
    .from("product_options")
    .select("product_option_id")
    .eq("product_option_group_id", groupId);
  if (existingOptionsError) throw new Error(existingOptionsError.message);

  const existingOptionIds = new Set(
    (existingOptions ?? []).map((option) => option.product_option_id),
  );
  const submittedOptionIds = new Set(
    submittedOptions
      .map((option) => option.product_option_id)
      .filter((optionId): optionId is string => Boolean(optionId)),
  );

  const hasUnknownOption = [...submittedOptionIds].some(
    (optionId) => !existingOptionIds.has(optionId),
  );
  if (hasUnknownOption) throw new Error("Opción no encontrada.");

  const removedOptionIds = [...existingOptionIds].filter(
    (optionId) => !submittedOptionIds.has(optionId),
  );
  if (removedOptionIds.length > 0) {
    const { error: deleteOptionsError } = await supabase
      .schema("mediasis")
      .from("product_options")
      .delete()
      .eq("product_option_group_id", groupId)
      .in("product_option_id", removedOptionIds);
    if (deleteOptionsError) throw new Error(deleteOptionsError.message);
  }

  for (const option of submittedOptions) {
    let optionId = option.product_option_id;

    if (optionId) {
      const { data: ownedOption } = await supabase
        .schema("mediasis")
        .from("product_options")
        .select("product_option_id")
        .eq("product_option_id", optionId)
        .eq("product_option_group_id", groupId)
        .maybeSingle();
      if (!ownedOption) throw new Error("Opción no encontrada.");
      const { error } = await supabase
        .schema("mediasis")
        .from("product_options")
        .update({
          name: option.name,
          type: option.type,
          required: option.required,
          enable_quantity: option.enable_quantity ?? false,
          validation: option.validation ?? null,
        })
        .eq("product_option_id", optionId);
      if (error) throw new Error(error.message);
    } else {
      const { data: newOption, error } = await supabase
        .schema("mediasis")
        .from("product_options")
        .insert({
          product_option_group_id: groupId,
          name: option.name,
          type: option.type,
          required: option.required,
          enable_quantity: option.enable_quantity ?? false,
          validation: option.validation ?? null,
        })
        .select("product_option_id")
        .single();
      if (error) throw new Error(error.message);
      optionId = newOption?.product_option_id;
    }

    if (!optionId) throw new Error("Error creating product option");

    if (option.product_option_id) {
      const { data: existingChoices, error: choicesError } = await supabase
        .schema("mediasis")
        .from("product_option_choices")
        .select("product_option_choice_id")
        .eq("product_option_id", optionId);
      if (choicesError) throw new Error(choicesError.message);

      const submittedChoiceIds = new Set(
        (option.choices ?? [])
          .map((choice) => choice.product_option_choice_id)
          .filter((choiceId): choiceId is string => Boolean(choiceId)),
      );
      const removedChoiceIds = (existingChoices ?? [])
        .map((choice) => choice.product_option_choice_id)
        .filter((choiceId) => !submittedChoiceIds.has(choiceId));

      if (removedChoiceIds.length > 0) {
        const { error: locationsError } = await supabase
          .schema("mediasis")
          .from("product_option_choice_locations")
          .delete()
          .in("product_option_choice_id", removedChoiceIds);
        if (locationsError) throw new Error(locationsError.message);

        const { error: deleteChoicesError } = await supabase
          .schema("mediasis")
          .from("product_option_choices")
          .delete()
          .in("product_option_choice_id", removedChoiceIds);
        if (deleteChoicesError) throw new Error(deleteChoicesError.message);
      }
    }

    for (const choice of option.choices ?? []) {
      let choiceId = choice.product_option_choice_id;
      let effectiveScope = choice.scope;
      let effectiveLocationIds = choice.location_ids ?? [];

      if (choiceId && !authorized.canManageAllLocations) {
        const [{ data: currentChoice }, { data: currentLocations }] = await Promise.all([
          supabase.schema("mediasis").from("product_option_choices").select("scope")
            .eq("product_option_choice_id", choiceId).maybeSingle(),
          supabase.schema("mediasis").from("product_option_choice_locations").select("business_location_id")
            .eq("product_option_choice_id", choiceId),
        ]);
        if (currentChoice?.scope === "all") {
          effectiveScope = "all";
          effectiveLocationIds = [];
        } else {
          const protectedIds = (currentLocations ?? []).map((row) => row.business_location_id)
            .filter((id) => !authorized.allowedLocationIds.has(id));
          effectiveScope = "specific";
          effectiveLocationIds = [...new Set([
            ...protectedIds,
            ...effectiveLocationIds.filter((id) => authorized.allowedLocationIds.has(id)),
          ])];
        }
      } else if (!authorized.canManageAllLocations && effectiveScope === "all") {
        throw new Error("Solo podés configurar opciones para tus ubicaciones permitidas.");
      }

      if (choiceId) {
        const { data: ownedChoice } = await supabase
          .schema("mediasis")
          .from("product_option_choices")
          .select("product_option_choice_id")
          .eq("product_option_choice_id", choiceId)
          .eq("product_option_id", optionId)
          .maybeSingle();
        if (!ownedChoice) throw new Error("Elección no encontrada.");
        const { error } = await supabase
          .schema("mediasis")
          .from("product_option_choices")
          .update({
            name: choice.name,
            price: choice.price,
            scope: effectiveScope,
            sequence: choice.sequence,
          })
          .eq("product_option_choice_id", choiceId);
        if (error) throw new Error(error.message);
      } else {
        const { data: newChoice, error } = await supabase
          .schema("mediasis")
          .from("product_option_choices")
          .insert({
            product_option_id: optionId,
            name: choice.name,
            price: choice.price,
            scope: effectiveScope,
            sequence: choice.sequence,
          })
          .select("product_option_choice_id")
          .single();
        if (error) throw new Error(error.message);
        choiceId = newChoice?.product_option_choice_id;
      }

      if (!choiceId) throw new Error("Error creating product option choice");

      // Sync location visibility when scope = 'specific'
      const { error: deleteLocationsError } = await supabase
        .schema("mediasis")
        .from("product_option_choice_locations")
        .delete()
        .eq("product_option_choice_id", choiceId);
      if (deleteLocationsError) throw new Error(deleteLocationsError.message);

      if (effectiveScope === "specific" && effectiveLocationIds.length) {
        const { error: insertLocationsError } = await supabase
          .schema("mediasis")
          .from("product_option_choice_locations")
          .insert(
            effectiveLocationIds.map((loc_id) => ({
              product_option_choice_id: choiceId!,
              business_location_id: loc_id,
            }))
          );
        if (insertLocationsError) throw new Error(insertLocationsError.message);
      }
    }
  }
}

// ----------------------------------------------------------------
// Types for the list page
// ----------------------------------------------------------------
export type OptionGroupRow = {
  product_option_group_id: string;
  name: string;
  kind: "general" | "side" | "extra";
  options: unknown[];
};

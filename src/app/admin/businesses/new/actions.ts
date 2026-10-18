"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";

import { BusinessCreationSchema, type BusinessCreationInput } from "@/lib/FormSchemas/businessCreationSchema";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { ensureOrderingAppUser } from "@/lib/dashboard/ordering-app-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getPublicSignupCatalog } from "@/lib/dashboard/merchant-onboarding";
import { guidedIdentitySchema, saveGuidedStepForOwner, type GuidedIdentity } from "@/lib/dashboard/guided-onboarding";

type ProvisioningResult = {
  success?: boolean;
  status?: string;
  business_id?: string;
  clerk_organization_id?: string | null;
  message?: string | null;
};

type ClerkErrorShape = {
  status?: number;
  clerkTraceId?: string;
  errors?: Array<{
    code?: string;
    message?: string;
    longMessage?: string;
  }>;
};

function getClerkErrorDetails(cause: unknown) {
  const clerkError = typeof cause === "object" && cause !== null ? cause as ClerkErrorShape : null;
  const firstError = clerkError?.errors?.[0];
  return {
    status: clerkError?.status ?? null,
    code: firstError?.code ?? null,
    traceId: clerkError?.clerkTraceId ?? null,
    message:
      firstError?.longMessage ??
      firstError?.message ??
      (cause instanceof Error ? cause.message : "No se pudo crear la organización."),
  };
}

async function findOrganizationByBusinessId(
  clerk: Awaited<ReturnType<typeof clerkClient>>,
  businessId: string,
) {
  const matches = [];
  const limit = 100;
  let offset = 0;

  // Organization slugs are optional in Clerk and are disabled in this
  // instance. The immutable private business ID is therefore our retry key.
  // Scan every page so a request that created Clerk successfully but failed
  // before the Supabase checkpoint can recover without creating a duplicate.
  do {
    const page = await clerk.organizations.getOrganizationList({ limit, offset });
    matches.push(
      ...page.data.filter(
        (organization) => organization.privateMetadata?.mediasisBusinessId === businessId,
      ),
    );
    offset += page.data.length;
    if (offset >= page.totalCount || page.data.length === 0) break;
  } while (true);

  if (matches.length > 1) {
    throw new Error("Hay más de una organización de Clerk asociada con este negocio.");
  }
  return matches[0] ?? null;
}

async function selectCreatedBusinessForStaff(mode: "legacy" | "clerk" | "staff", businessId: string) {
  if (mode !== "staff") return;
  const cookieStore = await cookies();
  cookieStore.set("mediasis_staff_business_id", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0,
  });
  cookieStore.set("mediasis_staff_business_id", businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function createDashboardBusiness(input: BusinessCreationInput, identity?: GuidedIdentity) {
  const parsed = BusinessCreationSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Revisá los datos del negocio." };

  const session = await auth();
  if (!session.userId) return { success: false, message: "Iniciá sesión con Clerk para crear un negocio." };
  const context = await getDashboardAuthorizationContext();
  if (!context || context.mode === "legacy" || !context.appUserId) {
    return { success: false, message: "No tenés permiso para crear negocios." };
  }

  const admin = createAdminClient();
  const { data: selection, error: selectionError } = await admin.schema("mediasis")
    .from("additional_business_onboarding")
    .select("additional_business_onboarding_id,country_code,status,subscription_plans!inner(stable_key)")
    .eq("owner_app_user_id", context.appUserId)
    .eq("provisioning_idempotency_key", parsed.data.idempotencyKey)
    .maybeSingle();
  if (selectionError || !selection || !["selected", "provisioning", "completed"].includes(selection.status)) {
    return { success: false, message: "Elegí un plan antes de crear el negocio." };
  }
  if (selection.country_code !== parsed.data.countryCode) {
    return { success: false, message: "El país no coincide con el plan seleccionado." };
  }
  const selectedPlan = Array.isArray(selection.subscription_plans) ? selection.subscription_plans[0] : selection.subscription_plans;
  const isUberSelection = selectedPlan?.stable_key === "uber_fijo" || selectedPlan?.stable_key === "uber_porcentaje";
  if (isUberSelection !== (context.mode === "staff")) {
    return { success: false, message: "El plan no corresponde a este flujo de creación." };
  }
  const guidedIdentity = context.mode === "staff" ? null : guidedIdentitySchema.safeParse(identity);
  if (guidedIdentity && !guidedIdentity.success) {
    return { success: false, message: "Elegí el enlace y los colores de tu negocio." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.schema("mediasis").rpc("begin_dashboard_business_provisioning_with_country", {
    p_idempotency_key: parsed.data.idempotencyKey,
    p_business_name: parsed.data.full_name,
    p_location_name: parsed.data.short_name,
    p_phone: parsed.data.phone,
    p_lat: parsed.data.location.lat,
    p_lng: parsed.data.location.lng,
    p_country_code: parsed.data.countryCode,
  });
  if (error) return { success: false, message: error.message };

  const provisioning = data as ProvisioningResult;
  if (!provisioning.business_id) return { success: false, message: provisioning.message ?? "No se pudo iniciar la creación." };
  if (provisioning.status === "completed" && provisioning.clerk_organization_id) {
    try {
      await ensureOrderingAppUser({
        admin,
        businessId: provisioning.business_id,
        businessName: parsed.data.full_name,
      });
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "No se pudo validar el usuario de la App de pedidos." };
    }
    const { data: completed, error: completeError } = await admin.schema("mediasis").rpc(context.mode === "staff"
      ? "complete_staff_uber_business_provisioning" : "prepare_additional_subscription_onboarding", {
      ...(context.mode === "staff" ? { p_staff_app_user_id: context.appUserId } : { p_owner_app_user_id: context.appUserId }),
      p_business_id: provisioning.business_id,
    });
    if (completeError || !completed?.success) {
      return { success: false, message: completeError?.message ?? "No se pudo completar el negocio." };
    }
    if (guidedIdentity?.success) await saveGuidedStepForOwner(provisioning.business_id, "business_setup", guidedIdentity.data);
    await selectCreatedBusinessForStaff(context.mode, provisioning.business_id);
    return { success: true, businessId: provisioning.business_id, organizationId: provisioning.clerk_organization_id, paymentRequired: context.mode !== "staff" };
  }

  let organizationId = provisioning.clerk_organization_id ?? null;
  let organizationCreated = Boolean(organizationId);
  let clerkMembershipId: string | null = null;

  try {
    const clerk = await clerkClient();
    if (!organizationId) {
      // Recover by immutable private metadata because this Clerk instance has
      // Organization slugs disabled. This preserves idempotency across a crash
      // between Clerk creation and the Supabase checkpoint.
      const existingOrganization = await findOrganizationByBusinessId(
        clerk,
        provisioning.business_id,
      );
      const organization = existingOrganization
        ?? await clerk.organizations.createOrganization({
          name: parsed.data.full_name,
          privateMetadata: { mediasisBusinessId: provisioning.business_id },
        });
      organizationId = organization.id;
      organizationCreated = true;
    }

    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId,
      userId: [session.userId],
      limit: 1,
    });
    const existingMembership = memberships.data[0];
    const membership = existingMembership
      ? existingMembership.role === "org:admin"
        ? existingMembership
        : await clerk.organizations.updateOrganizationMembership({
            organizationId,
            userId: session.userId,
            role: "org:admin",
          })
      : await clerk.organizations.createOrganizationMembership({
          organizationId,
          userId: session.userId,
          role: "org:admin",
        });
    clerkMembershipId = membership.id;

    const { data: recorded, error: recordError } = await admin.schema("mediasis").rpc(
      "record_dashboard_business_organization",
      {
        p_business_id: provisioning.business_id,
        p_clerk_organization_id: organizationId,
        p_clerk_membership_id: clerkMembershipId,
      }
    );
    if (recordError || !recorded?.success) throw new Error(recordError?.message ?? "No se pudo registrar la organización.");

    const orderingAppUser = await ensureOrderingAppUser({
      admin,
      businessId: provisioning.business_id,
      businessName: parsed.data.full_name,
    });
    if (orderingAppUser.created) {
      const { data: operatorCompleted, error: operatorCompleteError } = await admin.schema("mediasis").rpc(
        "complete_legacy_business_supervisor",
        {
          p_business_id: provisioning.business_id,
          p_actor_app_user_id: context.appUserId,
          p_email: orderingAppUser.email,
        },
      );
      if (operatorCompleteError || !operatorCompleted?.success) {
        throw new Error(operatorCompleteError?.message ?? operatorCompleted?.message ?? "No se pudo registrar el usuario de la App de pedidos.");
      }
    }

    const { data: completed, error: completeError } = await admin.schema("mediasis").rpc(
      context.mode === "staff" ? "complete_staff_uber_business_provisioning" : "prepare_additional_subscription_onboarding",
      context.mode === "staff"
        ? { p_staff_app_user_id: context.appUserId, p_business_id: provisioning.business_id }
        : { p_owner_app_user_id: context.appUserId, p_business_id: provisioning.business_id }
    );
    if (completeError || !completed?.success) throw new Error(completeError?.message ?? "No se pudo completar el negocio.");
    if (guidedIdentity?.success) await saveGuidedStepForOwner(provisioning.business_id, "business_setup", guidedIdentity.data);

    await selectCreatedBusinessForStaff(context.mode, provisioning.business_id);
    return { success: true, businessId: provisioning.business_id, organizationId, paymentRequired: context.mode !== "staff" };
  } catch (cause) {
    const clerkError = getClerkErrorDetails(cause);
    const message = clerkError.code
      ? `${clerkError.code}: ${clerkError.message}`
      : clerkError.message;
    console.error("[Mediasis business provisioning] Clerk provisioning failed", {
      businessId: provisioning.business_id,
      organizationCreated,
      membershipCreated: Boolean(clerkMembershipId),
      status: clerkError.status,
      code: clerkError.code,
      traceId: clerkError.traceId,
    });
    if (!organizationCreated) {
      await admin.schema("mediasis").rpc("fail_dashboard_business_provisioning", {
        p_business_id: provisioning.business_id,
        p_error: message,
      });
    }
    return {
      success: false,
      recoverable: organizationCreated,
      message: organizationCreated
        ? "La organización fue creada, pero falta finalizar la configuración. Reintentá con el mismo formulario."
        : message,
    };
  }
}

export async function selectStaffUberPlan(input: {
  planKey: "uber_fijo" | "uber_porcentaje";
  countryCode: string;
  weeklyFee: number;
  salesPercentage: number;
}) {
  const context = await getDashboardAuthorizationContext();
  if (context?.mode !== "staff" || !context.appUserId) throw new Error("Solo el equipo de Mediasis puede configurar este plan.");
  if (!Number.isFinite(input.weeklyFee) || input.weeklyFee < 0 || !Number.isFinite(input.salesPercentage)
    || input.salesPercentage < 0 || input.salesPercentage > 100) throw new Error("Revisá los términos del plan.");
  const admin = createAdminClient();
  const [{ data: market }, { data: plan }] = await Promise.all([
    admin.schema("mediasis").from("market_country_profiles")
      .select("country_code,default_currency_code,currency_minor_unit_digits")
      .eq("country_code", input.countryCode).eq("active", true).maybeSingle(),
    admin.schema("mediasis").from("subscription_plans")
      .select("subscription_plan_id,stable_key")
      .eq("stable_key", input.planKey).eq("active", true).maybeSingle(),
  ]);
  if (!market || !plan || !["uber_fijo", "uber_porcentaje"].includes(plan.stable_key)) throw new Error("Plan o país no disponible.");
  const multiplier = 10 ** Number(market.currency_minor_unit_digits);
  const fixedFeeMinor = Math.round(input.weeklyFee * multiplier);
  const percentageBasisPoints = Math.round(input.salesPercentage * 100);
  if (!Number.isSafeInteger(fixedFeeMinor) || fixedFeeMinor < 0) throw new Error("El monto no es válido.");
  const idempotencyKey = randomUUID();
  const { data, error } = await admin.schema("mediasis").from("additional_business_onboarding").insert({
    owner_app_user_id: context.appUserId,
    subscription_plan_id: plan.subscription_plan_id,
    country_code: market.country_code,
    billing_cadence: "monthly", // Legacy intent constraint; the actual Uber assignment is weekly.
    offered_currency_code: market.default_currency_code,
    offered_fixed_fee_minor: fixedFeeMinor,
    offered_sales_percentage_basis_points: percentageBasisPoints,
    provisioning_idempotency_key: idempotencyKey,
  }).select("additional_business_onboarding_id").single();
  if (error || !data) throw new Error(error?.message ?? "No se pudieron guardar los términos.");
  return { intentId: data.additional_business_onboarding_id as string };
}

export async function selectAdditionalBusinessPlan(input: {
  planKey: "lite" | "basic";
  countryCode: string;
  billingCadence: "monthly" | "annual";
}) {
  const session = await auth();
  const context = await getDashboardAuthorizationContext();
  if (!session.userId || !context?.appUserId || context.mode === "legacy") {
    throw new Error("Iniciá sesión para crear un negocio.");
  }
  if (!["lite", "basic"].includes(input.planKey) || !["monthly", "annual"].includes(input.billingCadence)) {
    throw new Error("Elegí un plan y una frecuencia válidos.");
  }
  const catalog = await getPublicSignupCatalog();
  const country = catalog.countries.find((item) => item.countryCode === input.countryCode);
  const plan = catalog.plans.find((item) => item.key === input.planKey);
  const currencyCode = plan?.billingCurrencyCode ?? country?.currencyCode;
  const price = currencyCode ? plan?.prices[currencyCode] : null;
  const fixedFeeMinor = input.billingCadence === "annual" ? price?.annualMinor : price?.monthlyMinor;
  if (!country || !plan || !currencyCode || fixedFeeMinor == null) {
    throw new Error("El país o plan seleccionado ya no está disponible.");
  }
  const admin = createAdminClient();
  const idempotencyKey = randomUUID();
  const { data, error } = await admin.schema("mediasis").from("additional_business_onboarding").insert({
    owner_app_user_id: context.appUserId,
    subscription_plan_id: plan.id,
    country_code: country.countryCode,
    billing_cadence: input.billingCadence,
    offered_currency_code: currencyCode,
    offered_fixed_fee_minor: fixedFeeMinor,
    provisioning_idempotency_key: idempotencyKey,
  }).select("additional_business_onboarding_id").single();
  if (error || !data) throw new Error(`No se pudo guardar el plan: ${error?.message ?? "sin datos"}`);
  return { intentId: data.additional_business_onboarding_id as string, idempotencyKey };
}

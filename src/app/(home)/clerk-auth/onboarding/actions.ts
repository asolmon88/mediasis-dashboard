"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

import { BusinessCreationSchema, type BusinessCreationInput } from "@/lib/FormSchemas/businessCreationSchema";
import { synchronizeClerkIdentity } from "@/lib/dashboard/auth";
import { ensureOrderingAppUser } from "@/lib/dashboard/ordering-app-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { guidedIdentitySchema, saveGuidedStepForOwner, type GuidedIdentity } from "@/lib/dashboard/guided-onboarding";

type ProvisioningResult = {
  status?: string;
  business_id?: string;
  clerk_organization_id?: string | null;
};

export async function createOnboardingBusiness(input: BusinessCreationInput, identity?: GuidedIdentity) {
  const parsed = BusinessCreationSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Revisá los datos del negocio." };
  const guidedIdentity = guidedIdentitySchema.safeParse(identity);
  if (!guidedIdentity.success) return { success: false, message: "Elegí el enlace y los colores de tu negocio." };
  const session = await auth();
  if (!session.userId) return { success: false, message: "Iniciá sesión para continuar." };
  const clerk = await clerkClient();
  const clerkUser = await clerk.users.getUser(session.userId);
  const verifiedEmail = clerkUser.emailAddresses.find((email) =>
    email.id === clerkUser.primaryEmailAddressId && email.verification?.status === "verified",
  )?.emailAddress?.toLowerCase();
  if (!verifiedEmail) return { success: false, message: "Verificá tu correo antes de crear el negocio." };
  await synchronizeClerkIdentity(session.userId);
  const admin = createAdminClient();
  const { data: owner, error: ownerError } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id,primary_email").eq("clerk_user_id", session.userId).single();
  if (ownerError || !owner || owner.primary_email?.toLowerCase() !== verifiedEmail) {
    return { success: false, message: "No se encontró una cuenta Mediasis con tu correo verificado." };
  }
  const { data: onboarding, error: onboardingError } = await admin.schema("mediasis").from("merchant_onboarding")
    .select("status,country_code,provisioning_idempotency_key,business_id")
    .eq("app_user_id", owner.app_user_id).single();
  if (onboardingError || !onboarding || onboarding.status !== "onboarding") {
    return { success: false, message: "Tu registro ya se completó o no está disponible." };
  }
  if (parsed.data.countryCode !== onboarding.country_code) {
    return { success: false, message: "El país no coincide con el que seleccionaste al registrarte." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.schema("mediasis").rpc("begin_dashboard_business_provisioning_with_country", {
    p_idempotency_key: onboarding.provisioning_idempotency_key,
    p_business_name: parsed.data.full_name,
    p_location_name: parsed.data.short_name,
    p_phone: parsed.data.phone,
    p_lat: parsed.data.location.lat,
    p_lng: parsed.data.location.lng,
    p_country_code: onboarding.country_code,
  });
  if (error) return { success: false, message: error.message };
  const provisioning = data as ProvisioningResult;
  if (!provisioning.business_id) return { success: false, message: "No se pudo iniciar la creación del negocio." };

  try {
    let organizationId = provisioning.clerk_organization_id ?? null;
    if (!organizationId) {
      // Recover a Clerk organization created before the database checkpoint.
      let offset = 0;
      let matches: Array<{ id: string }> = [];
      while (true) {
        const page = await clerk.organizations.getOrganizationList({ limit: 100, offset });
        matches = matches.concat(page.data.filter((organization) =>
          organization.privateMetadata?.mediasisBusinessId === provisioning.business_id));
        offset += page.data.length;
        if (offset >= page.totalCount || page.data.length === 0) break;
      }
      if (matches.length > 1) throw new Error("Hay más de una organización asociada con este negocio.");
      organizationId = matches[0]?.id ?? (await clerk.organizations.createOrganization({
        name: parsed.data.full_name,
        privateMetadata: { mediasisBusinessId: provisioning.business_id },
      })).id;
    }
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId, userId: [session.userId], limit: 1,
    });
    const existingMembership = memberships.data[0];
    const membership = existingMembership
      ? existingMembership.role === "org:admin" ? existingMembership
        : await clerk.organizations.updateOrganizationMembership({
          organizationId, userId: session.userId, role: "org:admin",
        })
      : await clerk.organizations.createOrganizationMembership({
          organizationId, userId: session.userId, role: "org:admin",
        });
    const { data: recorded, error: recordError } = await admin.schema("mediasis")
      .rpc("record_dashboard_business_organization", {
        p_business_id: provisioning.business_id,
        p_clerk_organization_id: organizationId,
        p_clerk_membership_id: membership.id,
      });
    if (recordError || !recorded?.success) throw new Error(recordError?.message ?? "No se pudo registrar la organización.");
    const operator = await ensureOrderingAppUser({
      admin, businessId: provisioning.business_id, businessName: parsed.data.full_name,
    });
    if (operator.created) {
      const { data: completed, error: completeError } = await admin.schema("mediasis")
        .rpc("complete_legacy_business_supervisor", {
          p_business_id: provisioning.business_id,
          p_actor_app_user_id: owner.app_user_id,
          p_email: operator.email,
        });
      if (completeError || !completed?.success) throw new Error(completeError?.message ?? "No se pudo configurar la App de pedidos.");
    }
    const { data: finalized, error: finalError } = await admin.schema("mediasis")
      .rpc("prepare_merchant_subscription_onboarding", {
        p_owner_app_user_id: owner.app_user_id, p_business_id: provisioning.business_id,
      });
    if (finalError || !finalized?.success) throw new Error(finalError?.message ?? "No se pudo preparar la facturación.");
    await saveGuidedStepForOwner(provisioning.business_id, "business_setup", guidedIdentity.data);
    return { success: true, businessId: provisioning.business_id, organizationId, paymentRequired: true };
  } catch (cause) {
    console.error("[Mediasis merchant provisioning] Could not finish business setup", {
      businessId: provisioning.business_id, error: cause,
    });
    return {
      success: false,
      message: cause instanceof Error ? cause.message : "No se pudo terminar el negocio. Reintentá con los mismos datos.",
    };
  }
}

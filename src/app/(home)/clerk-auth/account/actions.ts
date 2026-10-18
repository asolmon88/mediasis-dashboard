"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createTilopaySdkToken } from "@/lib/tilopay/billing";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentAccount() {
  const { userId } = await auth();
  if (!userId) throw new Error("Iniciá sesión para administrar tu cuenta.");
  const admin = createAdminClient();
  const { data: user, error } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id,primary_email,dashboard_disabled_at")
    .eq("clerk_user_id", userId).eq("status", "active").is("deleted_at", null).single();
  if (error || !user) throw new Error("No se pudo identificar tu cuenta.");
  return { admin, userId, user };
}

function requireDashboardAccess(user: { dashboard_disabled_at: string | null }) {
  if (user.dashboard_disabled_at) throw new Error("Tu acceso al dashboard ya fue cerrado.");
}

export async function getAccountLifecycleData() {
  const { admin, user } = await currentAccount();
  requireDashboardAccess(user);
  const [{ data: owners, error: ownersError }, { data: incoming, error: incomingError }] = await Promise.all([
    admin.schema("mediasis").from("business_account_owners")
      .select("business_id,businesses!inner(full_name,active)")
      .eq("owner_app_user_id", user.app_user_id),
    admin.schema("mediasis").from("business_ownership_transfers")
      .select("transfer_id,business_id,from_app_user_id,businesses!inner(full_name)")
      .eq("to_app_user_id", user.app_user_id).eq("status", "pending"),
  ]);
  if (ownersError || incomingError) throw new Error("No se pudieron cargar tus negocios.");
  const owned = await Promise.all((owners ?? []).map(async (owner) => {
    const { data: subscription } = await admin.schema("mediasis").from("business_subscriptions")
      .select("status,amount_minor,currency_code,billing_cadence")
      .eq("business_id", owner.business_id).maybeSingle();
    const { data: members, error } = await admin.schema("mediasis").from("business_memberships")
      .select("app_user_id,app_users!inner(primary_email,display_name,dashboard_disabled_at)")
      .eq("business_id", owner.business_id).eq("status", "active")
      .neq("app_user_id", user.app_user_id);
    if (error) throw new Error("No se pudieron cargar los miembros del negocio.");
    const { data: pending } = await admin.schema("mediasis").from("business_ownership_transfers")
      .select("transfer_id,to_app_user_id").eq("business_id", owner.business_id)
      .eq("status", "pending").maybeSingle();
    return { ...owner, subscription, members: (members ?? []).filter((member) => {
      const identity = Array.isArray(member.app_users) ? member.app_users[0] : member.app_users;
      return !identity?.dashboard_disabled_at;
    }), pending };
  }));
  const incomingWithSubscription = await Promise.all((incoming ?? []).map(async (transfer) => {
    const { data: subscription } = await admin.schema("mediasis").from("business_subscriptions")
      .select("amount_minor,currency_code,billing_cadence")
      .eq("business_id", transfer.business_id).maybeSingle();
    return { ...transfer, subscription };
  }));
  return { owned, incoming: incomingWithSubscription, email: user.primary_email ?? "", disabled: Boolean(user.dashboard_disabled_at) };
}

export async function requestOwnershipTransfer(businessId: string, recipientAppUserId: string) {
  if (!uuid.test(businessId) || !uuid.test(recipientAppUserId)) return { success: false, message: "Selección inválida." };
  try {
    const { admin, user } = await currentAccount();
    requireDashboardAccess(user);
    const { data, error } = await admin.schema("mediasis").rpc("request_business_ownership_transfer", {
      p_owner_app_user_id: user.app_user_id, p_business_id: businessId,
      p_recipient_app_user_id: recipientAppUserId,
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo solicitar la transferencia.");
    revalidatePath("/admin/account");
    return { success: true, message: "Solicitud enviada. La otra persona debe aceptarla." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "No se pudo solicitar la transferencia." };
  }
}

export async function createTransferTilopaySdkToken() {
  try {
    const { user } = await currentAccount();
    requireDashboardAccess(user);
    if (!user.primary_email) throw new Error("Agregá un correo verificado antes de aceptar la propiedad.");
    const token = await createTilopaySdkToken();
    return { success: true as const, billingEmail: user.primary_email, ...token };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar la tarjeta." };
  }
}

export async function acceptOwnershipTransfer(input: {
  transferId: string; cardToken?: string; brand?: string; label?: string;
}) {
  if (!uuid.test(input.transferId)) return { success: false, message: "Solicitud inválida." };
  try {
    const { admin, user } = await currentAccount();
    requireDashboardAccess(user);
    const { data, error } = await admin.schema("mediasis").rpc("accept_business_ownership_transfer_safe", {
      p_recipient_app_user_id: user.app_user_id, p_transfer_id: input.transferId,
      p_card_token: input.cardToken ?? "",p_cardholder_email: user.primary_email ?? "",
      p_card_brand: input.brand ?? "",p_card_label: input.label ?? "",
      p_consent_version: "2026-10-05-transfer",
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo aceptar la transferencia.");
    revalidatePath("/admin/account");
    return { success: true, message: "Ahora sos propietario del negocio." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "No se pudo aceptar la transferencia." };
  }
}

export async function deleteDashboardAccess() {
  try {
    const { admin, user, userId } = await currentAccount();
    const { data, error } = await admin.schema("mediasis").rpc("delete_dashboard_access", {
      p_app_user_id: user.app_user_id,
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo cerrar tu acceso.");
    const { data: consumer } = await admin.schema("mediasis").from("consumer_profiles")
      .select("consumer_enabled_at").eq("app_user_id", user.app_user_id)
      .is("deleted_at", null).maybeSingle();
    if (!consumer?.consumer_enabled_at) {
      await (await clerkClient()).users.deleteUser(userId);
    }
    return { success: true, message: "Tu acceso al dashboard fue cerrado." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "No se pudo cerrar tu acceso." };
  }
}

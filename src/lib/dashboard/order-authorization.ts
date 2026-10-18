import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const FULL_ORDERS_PERMISSION = "orders.manage.full";

export async function requireFullOrdersAccess() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId || !hasDashboardPermission(context, FULL_ORDERS_PERMISSION)) {
    return { success: false as const, message: "No tenés permiso para administrar pedidos." };
  }
  return { success: true as const, context, businessId: context.activeBusinessId };
}

export async function requireOrderAccess(orderId: string) {
  const authorized = await requireFullOrdersAccess();
  if (!authorized.success) return authorized;

  const admin = createAdminClient();
  const { data: order, error } = await admin
    .schema("mediasis")
    .from("orders")
    .select("order_id, business_location_id, delivery_method, business_payment_method_id, products_payment_intent_id, products_payment_status, delivery_payment_intent_id, delivery_payment_status, order_status, payment_provider, onvo_keys_id, tilopay_account_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error || !order?.business_location_id) {
    return { success: false as const, message: "Pedido no encontrado." };
  }

  const locationAllowed = authorized.context.locations.some(
    (location) => location.business_location_id === order.business_location_id,
  );
  if (!locationAllowed) {
    return { success: false as const, message: "Pedido no encontrado." };
  }

  const { data: location } = await admin
    .schema("mediasis")
    .from("business_location")
    .select("business_uid")
    .eq("business_location_id", order.business_location_id)
    .eq("business_uid", authorized.businessId)
    .maybeSingle();
  if (!location) return { success: false as const, message: "Pedido no encontrado." };

  return {
    success: true as const,
    context: authorized.context,
    admin,
    businessId: authorized.businessId,
    order,
  };
}

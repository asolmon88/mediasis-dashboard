"use server";

import { requireOrderAccess } from "@/lib/dashboard/order-authorization";

export type EditableOrderStatus = "pending" | "preparing" | "ready" | "cancelled";

export async function updateOrderStatusAction(orderId: string, nextStatus: EditableOrderStatus) {
  if (!orderId || !["pending", "preparing", "ready", "cancelled"].includes(nextStatus)) {
    return { success: false, message: "Estado de pedido inválido." };
  }
  const authorized = await requireOrderAccess(orderId);
  if (!authorized.success) return authorized;
  const { error } = await authorized.admin
    .schema("mediasis")
    .from("orders")
    .update({ order_status: nextStatus })
    .eq("order_id", orderId)
    .eq("business_location_id", authorized.order.business_location_id);
  return error
    ? { success: false, message: "No se pudo actualizar el estado del pedido." }
    : { success: true };
}

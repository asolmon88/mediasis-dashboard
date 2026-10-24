"use server";

import { requireOrderAccess } from "@/lib/dashboard/order-authorization";
import { updateOrderStatusAction } from "@/app/admin/orders/actions";
import {
  updatePickupWindow,
  type UpdatePickupWindowResult,
} from "@/lib/orders/update-pickup-window";
import {
  createUberDelivery,
  type CreateUberDeliveryResult,
} from "@/lib/orders/create-uber-delivery";

type UpdateOrderStatusResult = {
  success: boolean;
  message?: string;
};

export async function markOrderReadyAction(orderId: string): Promise<UpdateOrderStatusResult> {
  return updateOrderStatusAction(orderId, "ready_for_pickup");
}

export async function updateUberPickupWindowAction(
  orderId: string,
  readyInMinutes: number
): Promise<UpdatePickupWindowResult> {
  const authorized = await requireOrderAccess(orderId);
  if (!authorized.success) return authorized;
  return updatePickupWindow(authorized.admin, authorized.businessId, orderId, readyInMinutes);
}

export async function createUberDeliveryAction(
  orderId: string
): Promise<CreateUberDeliveryResult> {
  const authorized = await requireOrderAccess(orderId);
  if (!authorized.success) return authorized;
  return createUberDelivery(authorized.admin, authorized.businessId, orderId);
}

'use server'

import { statusOptionsDBToUserReadable } from "@/lib/dashboardData";
import { sendBrevoEmail } from "@/lib/emails/brevo";
import { ReservationEditSchema, type ReservationEditInput } from "@/lib/FormSchemas/reseravtionEditSchema";
import { requireReservationsManagementAccess } from "@/lib/dashboard/reservation-authorization";
import type { Reservation, ReservationEditFormValues } from "@/lib/types/dashboardTypes";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";

type RpcResult<T = unknown> = { success?: boolean; message?: string; data?: T; domain?: string; notification?: {
  client_email?: string | null; location_name?: string | null; avatar_url?: string | null;
} };

async function reservationRpc<T>(name: string, args: Record<string, unknown>) {
  const access = await requireReservationsManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc(name, {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
    ...args,
  });
  const result = data as RpcResult<T> | null;
  if (error || !result?.success) return {
    success: false as const,
    message: error?.message ?? result?.message ?? "La operación no pudo completarse.",
  };
  return { success: true as const, result };
}

export async function getReservations(locationId: string, startAt: string, endAt: string) {
  const response = await reservationRpc<Reservation[]>("get_dashboard_reservations", {
    p_location_id: locationId, p_start_at: startAt, p_end_at: endAt,
  });
  return response.success
    ? { success: true as const, reservations: response.result.data ?? [] }
    : response;
}

export async function getReservation(
  locationId: string,
  reservationId: string,
): Promise<{ success: true; reservation: Reservation | null } | { success: false; message: string }> {
  const response = await reservationRpc<Reservation>("get_dashboard_reservation", {
    p_location_id: locationId, p_reservation_id: reservationId,
  });
  return response.success
    ? { success: true as const, reservation: response.result.data ?? null }
    : response;
}

export async function getReservationStorefrontDomain() {
  const response = await reservationRpc("get_dashboard_reservation_domain", {});
  return response.success
    ? { success: true as const, domain: response.result.domain ?? null }
    : response;
}

export async function updateReservation(
  id: string,
  values: ReservationEditInput,
  formValues: ReservationEditFormValues,
): Promise<{ success: boolean; message: string }> {
  const parsed = ReservationEditSchema.safeParse(values);
  if (!parsed.success) return { success: false, message: parsed.error.message };
  const response = await reservationRpc("update_dashboard_reservation", {
    p_reservation_id: id,
    p_date: formValues.date.toISOString(),
    p_size: formValues.group_size,
    p_status: formValues.status,
  });
  if (!response.success) return response;

  const notification = response.result.notification;
  if (notification?.client_email) {
    const market = (await getDashboardAuthorizationContext())?.market;
    if (!market) return { success: false, message: "El negocio no tiene configuración regional." };
    await sendBrevoEmail({
      senderName: "mediasis Reservas",
      senderEmail: "alejandrog@mediasis.cr",
      to: [notification.client_email],
      templateId: 2,
      params: {
        AVATAR_URL: notification.avatar_url ?? "",
        LOCATION: notification.location_name ?? "",
        AMOUNT: formValues.group_size,
        DATE: new Date(formValues.date).toLocaleString(market.locale, {
          dateStyle: "short", timeStyle: "short", timeZone: market.timezone,
        }),
        STATUS: statusOptionsDBToUserReadable[formValues.status],
      },
    });
  }
  return { success: true, message: "Reservación actualizada" };
}

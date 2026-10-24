import { getUberToken } from "@/lib/supabase/uber-tokens";
import { translateUberError } from "@/lib/orders/uber-error-utils";

export type UpdatePickupWindowResult = {
  success: boolean;
  changed?: boolean;
  pickupReadyAt?: string;
  pickupDeadlineAt?: string;
  pickupEta?: string;
  dropoffEta?: string;
  message?: string;
};

type DeliveryWindow = {
  pickupReady: Date;
  pickupDeadline: Date;
  dropoffReady: Date;
  dropoffDeadline: Date;
};

export function calculateEarliestDeliveryWindow(
  now: number,
  readyInMinutes: number
): DeliveryWindow {
  const safeMinutes = Number.isFinite(readyInMinutes)
    ? Math.max(1, Math.floor(readyInMinutes))
    : 2;
  const pickupReady = new Date(now + safeMinutes * 60_000);
  const pickupDeadline = new Date(
    Math.max(pickupReady.getTime() + 10 * 60_000, now + 20 * 60_000)
  );
  const dropoffReady = pickupReady;
  const dropoffDeadline = new Date(
    Math.max(dropoffReady.getTime() + 20 * 60_000, pickupDeadline.getTime())
  );
  return { pickupReady, pickupDeadline, dropoffReady, dropoffDeadline };
}

async function fetchUberDelivery(
  url: string,
  token: string
): Promise<{ success: true; delivery: any } | { success: false; message: string }> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return { success: false, message: translateUberError(await response.text()) };
  }
  return { success: true, delivery: await response.json() };
}

function parseUberTimestamp(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

export async function resolveUberDeliveryContext(
  supabase: any,
  userId: string,
  orderId: string
): Promise<
  | {
      success: true;
      deliveryId: string | null;
      requireCourier: boolean;
      customerId: string;
      token: string;
      baseUrl: string;
      deliveryCreatedAt: string | null;
      orderStatus: string | null;
    }
  | {
      success: false;
      message: string;
    }
> {
  const { data: orderData, error: orderError } = await supabase
    .schema("mediasis")
    .from("orders")
    .select("uber_delivery_id, delivery_method, business_location_id, delivery_created_at, order_status")
    .eq("order_id", orderId)
    .maybeSingle();

  if (orderError || !orderData) {
    return { success: false, message: "Pedido no encontrado" };
  }

  const businessLocationId =
    (orderData as { business_location_id?: string | null }).business_location_id ?? null;
  const deliveryMethodId =
    (orderData as { delivery_method?: string | null }).delivery_method ?? null;
  const ordersDeliveryId =
    (orderData as { uber_delivery_id?: string | null }).uber_delivery_id ?? null;
  const ordersDeliveryCreatedAt =
    (orderData as { delivery_created_at?: string | null }).delivery_created_at ?? null;
  const orderStatus =
    (orderData as { order_status?: string | null }).order_status ?? null;

  if (!businessLocationId) {
    return { success: false, message: "Pedido inválido para actualización" };
  }

  // Prefer uber_deliveries as source of truth; fall back to orders fields
  const { data: activeDelivery } = await supabase
    .schema("mediasis")
    .from("uber_deliveries")
    .select("uber_delivery_id, created_at")
    .eq("order_id", orderId)
    .eq("is_active", true)
    .maybeSingle();

  const deliveryId = activeDelivery?.uber_delivery_id ?? ordersDeliveryId;
  const deliveryCreatedAt = activeDelivery?.created_at ?? ordersDeliveryCreatedAt;

  const { data: locationData, error: locationError } = await supabase
    .schema("mediasis")
    .from("business_location")
    .select("business_uid")
    .eq("business_location_id", businessLocationId)
    .maybeSingle();

  if (locationError || !locationData || locationData.business_uid !== userId) {
    return { success: false, message: "Pedido no autorizado" };
  }

  let requireCourier = false;
  if (deliveryMethodId) {
    const { data: methodData, error: methodError } = await supabase
      .schema("mediasis")
      .from("delivery_methods_business")
      .select("require_courier")
      .eq("uid", deliveryMethodId)
      .maybeSingle();

    if (methodError) {
      return { success: false, message: "No se pudo validar método de delivery" };
    }

    requireCourier = methodData?.require_courier ?? false;
  }

  if (!requireCourier || !deliveryId) {
    return { success: false, message: "Pedido no elegible para consultar Uber" };
  }

  const { data: customerData, error: customerError } = await supabase
    .schema("mediasis")
    .from("uber_keys")
    .select("customer_id")
    .eq("business_id", userId)
    .maybeSingle();

  if (customerError || !customerData?.customer_id) {
    return { success: false, message: "No se encontró customer_id de Uber" };
  }

  const token = await getUberToken(userId);
  const baseUrl = process.env.NEXT_PUBLIC_UBER_BASE_URL;
  if (!baseUrl) {
    return { success: false, message: "NEXT_PUBLIC_UBER_BASE_URL no está configurada" };
  }

  return {
    success: true,
    deliveryId,
    requireCourier,
    customerId: customerData.customer_id,
    token,
    baseUrl,
    deliveryCreatedAt,
    orderStatus,
  };
}

export async function updatePickupWindow(
  supabase: any,
  userId: string,
  orderId: string,
  readyInMinutes: number
): Promise<UpdatePickupWindowResult> {
  const context = await resolveUberDeliveryContext(supabase, userId, orderId);
  if (!context.success && context.message !== "Pedido no elegible para consultar Uber") {
    return { success: false, message: context.message };
  }

  const shouldUpdateUber = context.success;
  const deliveryCreatedAt = context.success ? context.deliveryCreatedAt : null;

  const now = Date.now();
  const { pickupReady, pickupDeadline, dropoffReady, dropoffDeadline } =
    calculateEarliestDeliveryWindow(now, readyInMinutes);
  let acceptedDelivery: any = null;

  try {
    if (shouldUpdateUber) {
      const deliveryUrl =
        `${context.baseUrl}customers/${context.customerId}/deliveries/${context.deliveryId}`;
      const currentResult = await fetchUberDelivery(deliveryUrl, context.token);
      if (!currentResult.success) return currentResult;
      const currentDelivery = currentResult.delivery;
      const status = String(currentDelivery?.status ?? "").toLowerCase();
      if (NON_EDITABLE_PICKUP_STATUSES.has(status)) {
        return {
          success: false,
          message: "Esta entrega ya no permite cambiar el horario de recogida.",
        };
      }

      const updatePayload: Record<string, string> = {
        pickup_ready_dt: pickupReady.toISOString(),
        pickup_deadline_dt: pickupDeadline.toISOString(),
        dropoff_ready_dt: dropoffReady.toISOString(),
        dropoff_deadline_dt: dropoffDeadline.toISOString(),
      };

      const response = await fetch(
        deliveryUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${context.token}`,
          },
          body: JSON.stringify(updatePayload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.log("[update-pickup-window] Uber error response:", response.status, errorText);
        let parsedCode: string | undefined;
        let parsedMetaDetails: string | undefined;
        try {
          const parsed = JSON.parse(errorText);
          parsedCode = (parsed?.code ?? parsed?.status) as string | undefined;
          parsedMetaDetails = parsed?.metadata?.param_details as string | undefined;
        } catch { /* not JSON */ }

        // Uber can reject a second reschedule. Never report that rejection as success.
        const isRescheduleLimitError =
          parsedCode === "invalid_params" &&
          typeof parsedMetaDetails === "string" &&
          parsedMetaDetails.toLowerCase().includes("rescheduled");

        if (isRescheduleLimitError) {
          return {
            success: false,
            message: "Uber no permite modificar nuevamente el horario de esta entrega.",
          };
        }

        const translated = translateUberError(errorText);
        await supabase
          .schema("mediasis")
          .from("uber_deliveries")
          .update({ integration_error: translated, integration_error_at: new Date(now).toISOString() })
          .eq("order_id", orderId)
          .eq("is_active", true);
        return { success: false, message: translated };
      }

      const refreshedResult = await fetchUberDelivery(deliveryUrl, context.token);
      const accepted = refreshedResult.success ? refreshedResult.delivery : {};
      acceptedDelivery = accepted;
      const { error: uberDeliveryUpdateError } = await supabase
        .schema("mediasis")
        .from("uber_deliveries")
        .update({
          pickup_ready: accepted.pickup_ready ?? pickupReady.toISOString(),
          pickup_deadline: accepted.pickup_deadline ?? pickupDeadline.toISOString(),
          pickup_eta: accepted.pickup_eta ?? null,
          dropoff_ready: accepted.dropoff_ready ?? dropoffReady.toISOString(),
          dropoff_deadline: accepted.dropoff_deadline ?? dropoffDeadline.toISOString(),
          dropoff_eta: accepted.dropoff_eta ?? null,
          updated_at: new Date(now).toISOString(),
          integration_error: null,
          integration_error_at: null,
        })
        .eq("order_id", orderId)
        .eq("is_active", true);

      if (uberDeliveryUpdateError) {
        console.error("Failed to update uber_deliveries:", uberDeliveryUpdateError.message);
      }
    }

    const orderUpdatePayload: {
      pickup_ready_dt: string;
      pickup_deadline_dt: string;
      delivery_created_at?: string;
    } = {
      pickup_ready_dt: acceptedDelivery?.pickup_ready ?? pickupReady.toISOString(),
      pickup_deadline_dt:
        acceptedDelivery?.pickup_deadline ?? pickupDeadline.toISOString(),
    };

    if (!deliveryCreatedAt) {
      orderUpdatePayload.delivery_created_at = new Date(now).toISOString();
    }

    const { error: orderUpdateError } = await supabase
      .schema("mediasis")
      .from("orders")
      .update(orderUpdatePayload)
      .eq("order_id", orderId);

    if (orderUpdateError) {
      return {
        success: false,
        message: `No se pudo guardar la actualización del pedido: ${orderUpdateError.message}`,
      };
    }

    return {
      success: true,
      changed: true,
      pickupReadyAt: orderUpdatePayload.pickup_ready_dt,
      pickupDeadlineAt: orderUpdatePayload.pickup_deadline_dt,
      pickupEta: parseUberTimestamp(acceptedDelivery?.pickup_eta)?.toISOString(),
      dropoffEta: parseUberTimestamp(acceptedDelivery?.dropoff_eta)?.toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}

const NON_EDITABLE_PICKUP_STATUSES = new Set([
  "pickup",
  "pickup_complete",
  "dropoff",
  "delivered",
  "canceled",
  "returned",
]);

export async function requestPickupNow(
  supabase: any,
  userId: string,
  orderId: string,
  requestId?: string
): Promise<UpdatePickupWindowResult> {
  const context = await resolveUberDeliveryContext(supabase, userId, orderId);
  if (!context.success) return context;

  if (context.orderStatus === "ready_for_pickup" || context.orderStatus === "ready") {
    return {
      success: false,
      message: "El pedido ya está listo para recoger o fue entregado",
    };
  }

  const now = Date.now();
  const { pickupReady, pickupDeadline, dropoffReady, dropoffDeadline } =
    calculateEarliestDeliveryWindow(now, 1);

  try {
    const deliveryUrl =
      `${context.baseUrl}customers/${context.customerId}/deliveries/${context.deliveryId}`;
    const currentResult = await fetchUberDelivery(deliveryUrl, context.token);
    if (!currentResult.success) return currentResult;
    const currentDelivery = currentResult.delivery;
    console.info("[pickup-now] current Uber delivery window", {
      requestId,
      orderId,
      deliveryId: context.deliveryId,
      status: currentDelivery?.status ?? null,
      pickupReady: currentDelivery?.pickup_ready ?? null,
      pickupDeadline: currentDelivery?.pickup_deadline ?? null,
      dropoffReady: currentDelivery?.dropoff_ready ?? null,
      dropoffDeadline: currentDelivery?.dropoff_deadline ?? null,
      pickupEta: currentDelivery?.pickup_eta ?? null,
      dropoffEta: currentDelivery?.dropoff_eta ?? null,
    });
    const status = String(currentDelivery?.status ?? "").toLowerCase();
    if (NON_EDITABLE_PICKUP_STATUSES.has(status)) {
      return {
        success: false,
        message: "Esta entrega ya no permite cambiar el horario de recogida.",
      };
    }

    const currentPickupReady = parseUberTimestamp(currentDelivery?.pickup_ready);
    const currentPickupDeadline = parseUberTimestamp(currentDelivery?.pickup_deadline);
    const currentDropoffReady = parseUberTimestamp(currentDelivery?.dropoff_ready);
    const currentDropoffDeadline = parseUberTimestamp(currentDelivery?.dropoff_deadline);
    const alreadyAsap =
      currentPickupReady &&
      currentPickupDeadline &&
      currentDropoffReady &&
      currentDropoffDeadline &&
      currentPickupReady.getTime() <= pickupReady.getTime() &&
      currentPickupDeadline.getTime() <= pickupDeadline.getTime() &&
      currentDropoffReady.getTime() <= dropoffReady.getTime() &&
      currentDropoffDeadline.getTime() <= dropoffDeadline.getTime();
    if (alreadyAsap) {
      return {
        success: true,
        changed: false,
        pickupReadyAt: currentPickupReady?.toISOString(),
        pickupDeadlineAt: currentPickupDeadline?.toISOString(),
        pickupEta: parseUberTimestamp(currentDelivery?.pickup_eta)?.toISOString(),
        dropoffEta: parseUberTimestamp(currentDelivery?.dropoff_eta)?.toISOString(),
        message: "La entrega ya esta programada para recogerse lo antes posible.",
      };
    }

    const updatePayload = {
      pickup_ready_dt: pickupReady.toISOString(),
      pickup_deadline_dt: pickupDeadline.toISOString(),
      dropoff_ready_dt: dropoffReady.toISOString(),
      dropoff_deadline_dt: dropoffDeadline.toISOString(),
    };
    console.info("[pickup-now] requested Uber delivery window", {
      requestId,
      orderId,
      deliveryId: context.deliveryId,
      ...updatePayload,
    });

    const updateResponse = await fetch(deliveryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${context.token}`,
      },
      body: JSON.stringify(updatePayload),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      let rescheduled = false;
      try {
        const error = JSON.parse(errorText);
        rescheduled =
          error?.code === "invalid_params" &&
          String(error?.metadata?.param_details ?? "")
            .toLowerCase()
            .includes("rescheduled");
      } catch {
        // translateUberError handles non-JSON responses.
      }
      const message = rescheduled
        ? "Uber no permite modificar nuevamente el horario de esta entrega."
        : translateUberError(errorText);
      await supabase
        .schema("mediasis")
        .from("uber_deliveries")
        .update({ integration_error: message, integration_error_at: new Date(now).toISOString() })
        .eq("order_id", orderId)
        .eq("is_active", true);
      return { success: false, message };
    }

    const refreshedResult = await fetchUberDelivery(deliveryUrl, context.token);
    const accepted = refreshedResult.success ? refreshedResult.delivery : {};
    console.info("[pickup-now] confirmed Uber delivery window", {
      requestId,
      orderId,
      deliveryId: context.deliveryId,
      fetchSucceeded: refreshedResult.success,
      status: accepted?.status ?? null,
      pickupReady: accepted?.pickup_ready ?? null,
      pickupDeadline: accepted?.pickup_deadline ?? null,
      dropoffReady: accepted?.dropoff_ready ?? null,
      dropoffDeadline: accepted?.dropoff_deadline ?? null,
      pickupEta: accepted?.pickup_eta ?? null,
      dropoffEta: accepted?.dropoff_eta ?? null,
    });
    const acceptedPickupReady = accepted.pickup_ready ?? pickupReady.toISOString();
    const acceptedPickupDeadline =
      accepted.pickup_deadline ?? pickupDeadline.toISOString();
    const acceptedDropoffReady = accepted.dropoff_ready ?? dropoffReady.toISOString();
    const acceptedDropoffDeadline =
      accepted.dropoff_deadline ?? dropoffDeadline.toISOString();
    const { error: deliveryUpdateError } = await supabase
      .schema("mediasis")
      .from("uber_deliveries")
      .update({
        pickup_ready: acceptedPickupReady,
        pickup_deadline: acceptedPickupDeadline,
        pickup_eta: accepted.pickup_eta ?? null,
        dropoff_ready: acceptedDropoffReady,
        dropoff_deadline: acceptedDropoffDeadline,
        dropoff_eta: accepted.dropoff_eta ?? null,
        updated_at: new Date(now).toISOString(),
        integration_error: null,
        integration_error_at: null,
      })
      .eq("order_id", orderId)
      .eq("is_active", true);

    const { error: orderUpdateError } = await supabase
      .schema("mediasis")
      .from("orders")
      .update({
        pickup_ready_dt: acceptedPickupReady,
        pickup_deadline_dt: acceptedPickupDeadline,
      })
      .eq("order_id", orderId);

    if (deliveryUpdateError || orderUpdateError) {
      return {
        success: false,
        message:
          "Uber acepto el nuevo horario, pero no se pudo sincronizar completamente el pedido.",
      };
    }

    return {
      success: true,
      changed: true,
      pickupReadyAt: acceptedPickupReady,
      pickupDeadlineAt: acceptedPickupDeadline,
      pickupEta: parseUberTimestamp(accepted.pickup_eta)?.toISOString(),
      dropoffEta: parseUberTimestamp(accepted.dropoff_eta)?.toISOString(),
      message: "Uber recibio la solicitud de recogida inmediata.",
    };
  } catch {
    return {
      success: false,
      message: "No se pudo conectar con Uber para actualizar la entrega.",
    };
  }
}

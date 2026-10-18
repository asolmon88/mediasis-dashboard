import { getUberToken } from "@/lib/supabase/uber-tokens";
import { translateUberError } from "@/lib/orders/uber-error-utils";
import { calculateEarliestDeliveryWindow } from "@/lib/orders/update-pickup-window";
import {
  buildUberDropoffNotes,
  buildUberManifestItemName,
  getCartLineTotals,
  UBER_PICKUP_NOTES,
  type CheckoutPayloadLike,
  type UberContextLike,
} from "@/lib/orders/uber-payload-utils";

export type CreateUberDeliveryResult = {
  success: boolean;
  message?: string;
};

export async function createUberDelivery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  orderId: string
): Promise<CreateUberDeliveryResult> {
  // --- 1. Fetch order ---
  const { data: orderData, error: orderError } = await supabase
    .schema("mediasis")
    .from("orders")
    .select(
      "drop_off_lat, drop_off_lng, client, business_location_id, human_order_number, products_price, delivery_method, checkout_payload"
    )
    .eq("order_id", orderId)
    .maybeSingle();

  if (orderError || !orderData) {
    return { success: false, message: "Pedido no encontrado" };
  }

  const {
    drop_off_lat,
    drop_off_lng,
    client: clientPhone,
    business_location_id: businessLocationId,
    human_order_number: humanOrderNumber,
    products_price: productsPrice,
    delivery_method: deliveryMethodId,
    checkout_payload: rawCheckoutPayload,
  } = orderData as {
    drop_off_lat: number | null;
    drop_off_lng: number | null;
    client: string | null;
    business_location_id: string | null;
    human_order_number: number | null;
    products_price: number | null;
    delivery_method: string | null;
    checkout_payload: unknown;
  };

  // Stored checkout payload (order app writes it since the uber_context work).
  // Older orders don't have it — every usage below falls back to DB-only data.
  const checkoutPayload =
    rawCheckoutPayload && typeof rawCheckoutPayload === "object"
      ? (rawCheckoutPayload as CheckoutPayloadLike)
      : null;
  const uberContext: UberContextLike | null = checkoutPayload?.uber_context ?? null;

  if (!businessLocationId || !clientPhone || drop_off_lat == null || drop_off_lng == null) {
    return { success: false, message: "El pedido no tiene datos de entrega completos" };
  }

  // --- 2. Verify delivery method requires courier ---
  if (deliveryMethodId) {
    const { data: methodData } = await supabase
      .schema("mediasis")
      .from("delivery_methods_business")
      .select("require_courier")
      .eq("uid", deliveryMethodId)
      .maybeSingle();

    if (!methodData?.require_courier) {
      return { success: false, message: "Este pedido no requiere courier de Uber" };
    }
  }

  // --- 3. Fetch business location + auth check ---
  // Pickup data ALWAYS comes from the current business_location row (staff may
  // have fixed a wrong location on the dashboard before re-calling Uber) —
  // never from the order's stored snapshot.
  const { data: locationData, error: locationError } = await supabase
    .schema("mediasis")
    .from("business_location")
    .select("business_uid, short_name, lat, lng, phone_number, text_address")
    .eq("business_location_id", businessLocationId)
    .maybeSingle();

  if (locationError || !locationData) {
    return { success: false, message: "Ubicación de negocio no encontrada" };
  }
  if (locationData.business_uid !== userId) {
    return { success: false, message: "No autorizado" };
  }

  const pickupLat = parseFloat(locationData.lat);
  const pickupLng = parseFloat(locationData.lng);

  // --- 4. Get uber_keys customer_id ---
  const { data: keysData, error: keysError } = await supabase
    .schema("mediasis")
    .from("uber_keys")
    .select("customer_id")
    .eq("business_id", userId)
    .maybeSingle();

  if (keysError || !keysData?.customer_id) {
    return { success: false, message: "No se encontró customer_id de Uber" };
  }
  const customerId = keysData.customer_id as string;

  // --- 5. Get auth token ---
  const token = await getUberToken(userId);
  const baseUrl = process.env.NEXT_PUBLIC_UBER_BASE_URL;
  if (!baseUrl) {
    return { success: false, message: "NEXT_PUBLIC_UBER_BASE_URL no está configurada" };
  }

  // --- 6. Check for existing active delivery and attempt cancellation ---
  const { data: existingDelivery } = await supabase
    .schema("mediasis")
    .from("uber_deliveries")
    .select("uber_delivery_id, status, attempt_number")
    .eq("order_id", orderId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingDelivery?.uber_delivery_id) {
    const cancelableStatuses = ["pending", "pickup"];
    if (cancelableStatuses.includes(existingDelivery.status ?? "")) {
      // Attempt cancellation — non-fatal
      try {
        await fetch(
          `${baseUrl}customers/${customerId}/deliveries/${existingDelivery.uber_delivery_id}/cancel`,
          { method: "POST", headers: { Authorization: `Bearer ${token}` } }
        );
      } catch {
        // ignore — we proceed to create a new one regardless
      }
    }
    // Mark old delivery inactive
    await supabase
      .schema("mediasis")
      .from("uber_deliveries")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .eq("is_active", true);
  }

  // --- 7. Compute next attempt number ---
  const { data: maxAttemptRow } = await supabase
    .schema("mediasis")
    .from("uber_deliveries")
    .select("attempt_number")
    .eq("order_id", orderId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextAttemptNumber = ((maxAttemptRow?.attempt_number as number | null) ?? 0) + 1;

  // --- 8. Fetch client name ---
  const { data: clientData } = await supabase
    .schema("mediasis")
    .from("client")
    .select("first_name, last_name")
    .eq("phone_number", clientPhone)
    .maybeSingle();

  // Prefer the name the customer typed at checkout; fall back to client table.
  const dropoffName =
    checkoutPayload?.name?.trim() ||
    (clientData
      ? `${clientData.first_name ?? ""} ${clientData.last_name ?? ""}`.trim()
      : clientPhone);

  // --- 9. Build manifest ---
  // Prefer the stored cart products (full fidelity: variant names, selected
  // options, option-inclusive prices — same builder as the original delivery);
  // fall back to the order_item join for older orders.
  const storedCartProducts = uberContext?.cart_products ?? [];

  let manifestItems: { name: string; quantity: number; size: "small"; price: number }[];

  if (storedCartProducts.length > 0) {
    manifestItems = storedCartProducts.map((item) => {
      const qty = item.options.quantity ?? 1;
      const { totalPrice } = getCartLineTotals({
        productPrice: item.product.price,
        productQuantity: qty,
        options: item.options,
      });

      return {
        name: buildUberManifestItemName(item),
        quantity: Math.max(1, Number(qty)),
        size: "small" as const,
        price: Math.round(totalPrice * 100),
      };
    });
  } else {
    const { data: itemRows } = await supabase
      .schema("mediasis")
      .from("order_item")
      .select(
        "quantity, unit_price, pv_id, product_variant(name, is_default, product(name))"
      )
      .eq("order_id", orderId);

    manifestItems = (itemRows ?? []).map((item: {
      quantity: number;
      unit_price: number;
      product_variant: { name: string; is_default: boolean; product: { name: string } } | null;
    }) => {
      const pv = item.product_variant;
      const productName = pv?.product?.name ?? "Producto";
      const variantName = pv && !pv.is_default ? pv.name : null;
      const name = variantName ? `${productName} - ${variantName}` : productName;
      return {
        name,
        quantity: item.quantity ?? 1,
        size: "small" as const,
        price: Math.round((item.unit_price ?? 0) * (item.quantity ?? 1) * 100),
      };
    });
  }

  const manifestTotalValue =
    productsPrice != null
      ? Math.round(productsPrice * 100)
      : manifestItems.reduce((sum, i) => sum + i.price, 0);

  // --- 10. Build delivery window ---
  const now = Date.now();
  const { pickupReady, pickupDeadline, dropoffReady, dropoffDeadline } =
    calculateEarliestDeliveryWindow(now, 1);

  // --- 11. Create delivery ---
  const pickupName = uberContext?.business_name?.trim()
    ? `${uberContext.business_name.trim()}, ${locationData.short_name ?? "Tienda"}`
    : locationData.short_name ?? "Tienda";
  const pickupAddress =
    (locationData.text_address as string | null)?.trim() ||
    `${pickupLat}, ${pickupLng}`;
  const dropoffAddress =
    uberContext?.user_location_label?.trim() || `${drop_off_lat}, ${drop_off_lng}`;
  const dropoffNotes = checkoutPayload
    ? buildUberDropoffNotes(checkoutPayload)
    : "Favor entregar al cliente";

  const deliveryPayload = {
    pickup_name: pickupName,
    pickup_address: pickupAddress,
    pickup_latitude: pickupLat,
    pickup_longitude: pickupLng,
    pickup_phone_number: locationData.phone_number ?? "",
    pickup_notes: UBER_PICKUP_NOTES,
    pickup_ready_dt: pickupReady.toISOString(),
    pickup_deadline_dt: pickupDeadline.toISOString(),
    pickup_verification: { picture: true },
    dropoff_name: dropoffName,
    dropoff_address: dropoffAddress,
    dropoff_latitude: drop_off_lat,
    dropoff_longitude: drop_off_lng,
    dropoff_phone_number: clientPhone,
    dropoff_notes: dropoffNotes,
    dropoff_ready_dt: dropoffReady.toISOString(),
    dropoff_deadline_dt: dropoffDeadline.toISOString(),
    dropoff_verification: {
      picture: true,
      signature_requirement: {
        enabled: true,
        collect_signer_name: true,
        collect_signer_relationship: true,
      },
    },
    manifest_items: manifestItems,
    manifest_total_value: manifestTotalValue,
    manifest_reference: orderId,
    external_id: humanOrderNumber != null ? String(humanOrderNumber) : undefined,
    external_store_id: businessLocationId,
    undeliverable_action: "return",
    return_verification: {
      picture: true,
      signature_requirement: {
        enabled: true,
        collect_signer_name: true,
        collect_signer_relationship: true,
      },
    },
    idempotency_key: `${orderId}_attempt_${nextAttemptNumber}`,
  };

  const deliveryResponse = await fetch(
    `${baseUrl}customers/${customerId}/deliveries`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(deliveryPayload),
    }
  );

  if (!deliveryResponse.ok) {
    const errorText = await deliveryResponse.text();
    const translated = translateUberError(errorText);
    // Store error on the most recent delivery row if one exists
    await supabase
      .schema("mediasis")
      .from("uber_deliveries")
      .update({ integration_error: translated, integration_error_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .eq("is_active", false)
      .order("created_at", { ascending: false })
      .limit(1);
    return { success: false, message: translated };
  }

  const deliveryResult = await deliveryResponse.json();
  const newDeliveryId = deliveryResult?.id as string | undefined;
  const trackingUrl = (deliveryResult?.tracking_url ?? deliveryResult?.tracking_url) as string | undefined;
  const deliveryStatus = (deliveryResult?.status ?? "pending") as string;

  if (!newDeliveryId) {
    return { success: false, message: "Uber no devolvió un ID de delivery" };
  }

  // --- 12. Persist result ---
  await supabase
    .schema("mediasis")
    .from("orders")
    .update({
      uber_delivery_id: newDeliveryId,
      tracking_link: trackingUrl ?? null,
      delivery_created_at: new Date(now).toISOString(),
    })
    .eq("order_id", orderId);

  await supabase
    .schema("mediasis")
    .from("uber_deliveries")
    .insert({
      order_id: orderId,
      business_location_id: businessLocationId,
      uber_delivery_id: newDeliveryId,
      uber_customer_id: customerId,
      attempt_number: nextAttemptNumber,
      is_active: true,
      delivery_role: "manual",
      status: deliveryStatus,
      tracking_url: trackingUrl ?? null,
      dropoff_lat: drop_off_lat,
      dropoff_lng: drop_off_lng,
      raw_delivery: deliveryResult,
    });

  return { success: true };
}

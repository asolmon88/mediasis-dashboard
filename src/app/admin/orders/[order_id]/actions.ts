"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUberToken } from "@/lib/supabase/uber-tokens";
import { translateUberError } from "@/lib/orders/uber-error-utils";
import { requireOrderAccess } from "@/lib/dashboard/order-authorization";

export type CancelOrderInput = {
  cancelUber: boolean;
  refundProducts: boolean;
  refundType?: "full" | "partial";
  partialRefundAmount?: string;
  sinpeRefundAcknowledged?: boolean;
  paidOutRefundAcknowledged?: boolean;
  cancelationReason?: string;
  additionalDescription?: string;
};

export type OperationOutcome = {
  requested: boolean;
  success: boolean;
  message?: string;
  requiresManualRefundConfirmation?: boolean;
};

export type CancelOrderResult = {
  success: boolean;
  message: string;
  orderCancelled: boolean;
  uber: OperationOutcome;
  refund: OperationOutcome;
};

export type OrderRefundRecord = {
  order_refund_id: string;
  provider_refund_id: string | null;
  payment_intent_id: string;
  amount_minor: number | null;
  refund_kind: "full" | "partial";
  currency: string | null;
  status: "creating" | "pending" | "succeeded" | "failed";
  reason: string | null;
  description: string | null;
  mode: string | null;
  failure_reason: string | null;
  provider_created_at: string | null;
  provider_updated_at: string | null;
  authorization_number: string | null;
  reference_number: string | null;
  transaction_reference: string | null;
  merchant_name: string | null;
  created_at: string;
};

type OnvoRefund = {
  id?: string;
  amount?: number | null;
  currency?: string | null;
  createdAt?: string | null;
  paymentIntentId?: string | null;
  description?: string | null;
  mode?: string | null;
  status?: "pending" | "succeeded" | "failed" | null;
  reason?: string | null;
  updatedAt?: string | null;
  failureReason?: string | null;
  authorizationNumber?: string | null;
  referenceNumber?: string | null;
  transactionReference?: string | null;
};

type TilopayModification = {
  type?: string;
  transactionId?: string | number;
  ReasonCode?: string | number;
  ReasonCodeDescription?: string;
  OrderHash?: string;
};

const TILOPAY_REFUND_SUCCESS_REASON_CODE = "1101";

const SINPE_PAYMENT_METHOD_ID = "fd220971-85d0-45d1-879d-8d3f7367547c";

const emptyOutcome = (requested: boolean): OperationOutcome => ({
  requested,
  success: !requested,
});

function failureResult(input: CancelOrderInput, message: string): CancelOrderResult {
  return {
    success: false,
    message,
    orderCancelled: false,
    uber: emptyOutcome(input.cancelUber),
    refund: emptyOutcome(input.refundProducts),
  };
}

function onvoErrorMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== "object") return `ONVO HTTP ${status}`;
  const value = payload as Record<string, unknown>;
  const code = typeof value.code === "string" ? value.code : null;
  const message = typeof value.message === "string" ? value.message : null;
  return [code, message].filter(Boolean).join(": ") || `ONVO HTTP ${status}`;
}

function isAlreadyPaidOutRefundError(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  const nestedError =
    value.error && typeof value.error === "object"
      ? (value.error as Record<string, unknown>)
      : null;
  const candidates = [value.code, value.message, nestedError?.code, nestedError?.message];
  return candidates.some(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.includes("refunds.payment_intent_already_payed"),
  );
}

async function verifyOrderOwner(orderId: string) {
  const authorized = await requireOrderAccess(orderId);
  if (!authorized.success) return authorized;
  return {
    success: true as const,
    supabase: authorized.admin,
    userId: authorized.businessId,
    order: authorized.order,
  };
}

async function isSinpeOrder(params: {
  supabase: ReturnType<typeof createAdminClient>;
  businessPaymentMethodId: string | null;
  userId: string;
}) {
  if (!params.businessPaymentMethodId) {
    return { success: true as const, isSinpe: false };
  }
  const { data, error } = await params.supabase
    .schema("mediasis")
    .from("business_payment_method")
    .select("payment_method_id")
    .eq("business_payment_method_id", params.businessPaymentMethodId)
    .eq("business_id", params.userId)
    .maybeSingle();
  if (error || !data) {
    return {
      success: false as const,
      message: "No se pudo verificar el método de pago del pedido.",
    };
  }
  return {
    success: true as const,
    isSinpe: data.payment_method_id === SINPE_PAYMENT_METHOD_ID,
  };
}

async function confirmManualSinpeRefund(params: {
  orderId: string;
  hasProductsPaymentIntent: boolean;
  hasDeliveryPaymentIntent: boolean;
}): Promise<OperationOutcome> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("SINPE refund admin client unavailable", {
      orderId: params.orderId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      requested: true,
      success: false,
      message: "El servidor no tiene configurado el acceso seguro para registrar el reembolso.",
    };
  }

  const updates: Record<string, string> = { order_status: "cancelled" };
  if (params.hasProductsPaymentIntent) updates.products_payment_status = "refunded";
  if (params.hasDeliveryPaymentIntent) updates.delivery_payment_status = "refunded";

  const { error } = await admin
    .schema("mediasis")
    .from("orders")
    .update(updates)
    .eq("order_id", params.orderId);
  if (error) {
    console.error("SINPE manual refund reconciliation failed", {
      orderId: params.orderId,
      code: error.code,
    });
    return {
      requested: true,
      success: false,
      message: "No se pudo registrar el reembolso manual de SINPE.",
    };
  }

  return {
    requested: true,
    success: true,
    message: "Reembolso manual de SINPE confirmado y pedido cancelado.",
  };
}

async function confirmManualPaidOutRefund(params: {
  orderId: string;
  paymentIntentId: string | null;
}): Promise<OperationOutcome> {
  if (!params.paymentIntentId) {
    return {
      requested: true,
      success: false,
      message: "El pedido no tiene un pago de productos para conciliar.",
    };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("Manual paid-out refund admin client unavailable", {
      orderId: params.orderId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      requested: true,
      success: false,
      message: "El servidor no tiene configurado el acceso seguro para registrar el reembolso.",
    };
  }

  const { data: failedAttempt, error: lookupError } = await admin
    .schema("mediasis")
    .from("order_refunds")
    .select("order_refund_id")
    .eq("order_id", params.orderId)
    .eq("payment_intent_id", params.paymentIntentId)
    .eq("status", "failed")
    .ilike("failure_reason", "%refunds.payment_intent_already_payed%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError || !failedAttempt) {
    console.error("Manual paid-out refund verification failed", {
      orderId: params.orderId,
      code: lookupError?.code ?? "eligible_attempt_not_found",
    });
    return {
      requested: true,
      success: false,
      message: "No se encontró el rechazo de ONVO que permite confirmar este reembolso manual.",
    };
  }

  const { error: updateError } = await admin
    .schema("mediasis")
    .from("orders")
    .update({
      products_payment_status: "refunded",
      order_status: "cancelled",
    })
    .eq("order_id", params.orderId)
    .eq("products_payment_intent_id", params.paymentIntentId);

  if (updateError) {
    console.error("Manual paid-out refund reconciliation failed", {
      orderId: params.orderId,
      code: updateError.code,
    });
    return {
      requested: true,
      success: false,
      message: "No se pudo registrar el reembolso manual ni cancelar el pedido.",
    };
  }

  return {
    requested: true,
    success: true,
    message: "Reembolso manual confirmado y pedido cancelado.",
  };
}

async function cancelUberDelivery(params: {
  supabase: ReturnType<typeof createAdminClient>;
  userId: string;
  orderId: string;
  deliveryMethodId: string | null;
  cancelationReason?: string;
  additionalDescription?: string;
}): Promise<OperationOutcome> {
  if (!params.cancelationReason) {
    return { requested: true, success: false, message: "Selecciona un motivo de cancelación de Uber." };
  }

  if (!params.deliveryMethodId) {
    return { requested: true, success: false, message: "El pedido no tiene un método de entrega válido." };
  }

  const { data: methodData, error: methodError } = await params.supabase
    .schema("mediasis")
    .from("delivery_methods_business")
    .select("require_courier, require_location")
    .eq("uid", params.deliveryMethodId)
    .maybeSingle();

  if (methodError || !methodData?.require_courier || !methodData?.require_location) {
    return { requested: true, success: false, message: "Este pedido no usa un delivery de Uber cancelable." };
  }

  const { data: activeDelivery, error: deliveryError } = await params.supabase
    .schema("mediasis")
    .from("uber_deliveries")
    .select("uber_delivery_id, status")
    .eq("order_id", params.orderId)
    .eq("is_active", true)
    .maybeSingle();

  if (deliveryError || !activeDelivery?.uber_delivery_id) {
    return { requested: true, success: false, message: "No hay un delivery activo de Uber para cancelar." };
  }

  const terminalStatuses = ["delivered", "canceled", "returned"];
  if (!terminalStatuses.includes(activeDelivery.status ?? "")) {
    try {
      const { data: keysData, error: keysError } = await params.supabase
        .schema("mediasis")
        .from("uber_keys")
        .select("customer_id")
        .eq("business_id", params.userId)
        .maybeSingle();
      const customerId = keysData?.customer_id;
      const baseUrl = process.env.NEXT_PUBLIC_UBER_BASE_URL;
      if (keysError || !customerId || !baseUrl) {
        return { requested: true, success: false, message: "No se pudo cargar la configuración de Uber." };
      }

      const token = await getUberToken(params.userId);
      const response = await fetch(
        `${baseUrl}customers/${customerId}/deliveries/${activeDelivery.uber_delivery_id}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            cancelation_reason: params.cancelationReason,
            ...(params.additionalDescription
              ? { additional_description: params.additionalDescription }
              : {}),
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Uber cancellation failed", {
          orderId: params.orderId,
          status: response.status,
        });
        return {
          requested: true,
          success: false,
          message: `Cancelación de Uber falló: ${translateUberError(errorText)}`,
        };
      }
    } catch (error) {
      console.error("Uber cancellation exception", {
        orderId: params.orderId,
        error: error instanceof Error ? error.message : "unknown",
      });
      return { requested: true, success: false, message: "No se pudo contactar a Uber." };
    }
  }

  const { error: deactivateError } = await params.supabase
    .schema("mediasis")
    .from("uber_deliveries")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("order_id", params.orderId)
    .eq("is_active", true);

  if (deactivateError) {
    return { requested: true, success: false, message: "Uber canceló el delivery, pero no se pudo actualizar localmente." };
  }

  return { requested: true, success: true, message: "Delivery de Uber cancelado." };
}

async function updateRefundRecord(
  admin: ReturnType<typeof createAdminClient>,
  recordId: string,
  refund: OnvoRefund,
  fallbackStatus: "pending" | "succeeded" | "failed",
) {
  return admin
    .schema("mediasis")
    .from("order_refunds")
    .update({
      provider_refund_id: refund.id ?? null,
      amount_minor: refund.amount ?? null,
      currency: refund.currency ?? null,
      status: refund.status ?? fallbackStatus,
      reason: refund.reason ?? null,
      description: refund.description ?? null,
      mode: refund.mode ?? null,
      failure_reason: refund.failureReason ?? null,
      provider_created_at: refund.createdAt ?? null,
      provider_updated_at: refund.updatedAt ?? null,
      authorization_number: refund.authorizationNumber ?? null,
      reference_number: refund.referenceNumber ?? null,
      transaction_reference: refund.transactionReference ?? null,
      provider_response: refund,
      updated_at: new Date().toISOString(),
    })
    .eq("order_refund_id", recordId);
}

async function refundProductsPayment(params: {
  orderId: string;
  paymentIntentId: string | null;
  onvoKeysId: string | null;
  userId: string;
}): Promise<OperationOutcome> {
  if (!params.paymentIntentId || !params.onvoKeysId) {
    return { requested: true, success: false, message: "El pedido no tiene un pago de productos para reembolsar." };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("Refund admin client unavailable", {
      orderId: params.orderId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { requested: true, success: false, message: "El servidor no tiene configurado el acceso seguro para reembolsos." };
  }

  const finalizeOrder = async () => {
    const { error } = await admin
      .schema("mediasis")
      .from("orders")
      .update({
        products_payment_status: "refunded",
        order_status: "cancelled",
      })
      .eq("order_id", params.orderId);
    return error;
  };

  const { data: existing, error: existingError } = await admin
    .schema("mediasis")
    .from("order_refunds")
    .select("order_refund_id, provider_refund_id, status")
    .eq("provider", "onvo")
    .eq("payment_intent_id", params.paymentIntentId)
    .in("status", ["creating", "pending", "succeeded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("Refund lookup failed", { orderId: params.orderId, code: existingError.code });
    return { requested: true, success: false, message: "No se pudo verificar el historial de reembolsos." };
  }

  if (existing?.status === "succeeded") {
    const reconciliationError = await finalizeOrder();
    if (reconciliationError) {
      console.error("Existing refund reconciliation failed", {
        orderId: params.orderId,
        code: reconciliationError.code,
      });
      return {
        requested: true,
        success: false,
        message: "El pago ya fue reembolsado, pero falta actualizar el estado local del pedido.",
      };
    }
    return { requested: true, success: true, message: "El pago de productos ya fue reembolsado." };
  }
  if (existing?.status === "creating") {
    return {
      requested: true,
      success: false,
      message: "Ya hay una solicitud de reembolso en proceso. Actualiza la página antes de volver a intentarlo.",
    };
  }

  const { data: routing, error: routingError } = await admin
    .schema("mediasis")
    .from("onvo_keys")
    .select("secret_key, onvo_account_id, enabled, credential_source, marketplace_connection_id")
    .eq("onvo_keys_id", params.onvoKeysId)
    .eq("business_id", params.userId)
    .maybeSingle();

  let onvoSecretKey = routing?.secret_key ?? null;
  if (!routingError && routing?.enabled && routing.credential_source === "marketplace" && routing.marketplace_connection_id) {
    const { data: marketplaceConnection } = await admin
      .schema("mediasis")
      .from("business_onvo_marketplace_connections")
      .select("status,onvo_marketplace_platform_config_id")
      .eq("business_onvo_marketplace_connection_id", routing.marketplace_connection_id)
      .maybeSingle();
    if (marketplaceConnection?.status === "active") {
      const { data: platformConfig } = await admin
        .schema("mediasis")
        .from("onvo_marketplace_platform_configs")
        .select("secret_key")
        .eq("onvo_marketplace_platform_config_id", marketplaceConnection.onvo_marketplace_platform_config_id)
        .eq("enabled", true)
        .maybeSingle();
      onvoSecretKey = platformConfig?.secret_key ?? null;
    }
  }

  if (routingError || !routing?.enabled || !onvoSecretKey || !routing.onvo_account_id) {
    console.error("ONVO refund routing failed", {
      orderId: params.orderId,
      code: routingError?.code ?? "routing_unavailable",
      message: routingError?.message ?? "missing routing data",
    });
    return {
      requested: true,
      success: false,
      message: routingError?.message ?? "No se pudo cargar la cuenta histórica de ONVO del pedido.",
    };
  }

  let recordId = existing?.order_refund_id as string | undefined;
  if (!recordId) {
    const { data: businessData } = await admin
      .schema("mediasis")
      .from("businesses")
      .select("full_name")
      .eq("uid", params.userId)
      .maybeSingle();
    const { data: created, error: createError } = await admin
      .schema("mediasis")
      .from("order_refunds")
      .insert({
        order_id: params.orderId,
        payment_intent_id: params.paymentIntentId,
        status: "creating",
        reason: "requested_by_customer",
        description: "Pedido cancelado",
        initiated_by: params.userId,
        merchant_name: businessData?.full_name ?? null,
      })
      .select("order_refund_id")
      .single();

    if (createError || !created) {
      if (createError?.code === "23505") {
        return { requested: true, success: false, message: "Ya hay un reembolso en proceso. Actualiza la página e inténtalo nuevamente." };
      }
      console.error("Refund claim failed", { orderId: params.orderId, code: createError?.code });
      return { requested: true, success: false, message: "No se pudo iniciar el registro seguro del reembolso." };
    }
    recordId = created.order_refund_id;
  }

  if (!recordId) {
    return { requested: true, success: false, message: "No se pudo identificar el registro del reembolso." };
  }

  let refund: OnvoRefund;
  try {
    const isPending = existing?.status === "pending" && existing.provider_refund_id;
    const response = await fetch(
      isPending
        ? `https://api.onvopay.com/v1/refunds/${existing.provider_refund_id}`
        : "https://api.onvopay.com/v1/refunds",
      {
        method: isPending ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${onvoSecretKey}`,
        },
        ...(isPending
          ? {}
          : {
              body: JSON.stringify({
                paymentIntentId: params.paymentIntentId,
                description: "Pedido cancelado",
                reason: "requested_by_customer",
                ...(routing.credential_source === "marketplace" ? { onBehalfOf: routing.onvo_account_id } : {}),
              }),
            }),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const safeMessage = onvoErrorMessage(payload, response.status);
      const requiresManualRefundConfirmation = isAlreadyPaidOutRefundError(payload);
      console.error("ONVO refund request failed", {
        orderId: params.orderId,
        status: response.status,
        message: safeMessage,
      });
      await admin
        .schema("mediasis")
        .from("order_refunds")
        .update({
          status: "failed",
          failure_reason: requiresManualRefundConfirmation
            ? "refunds.payment_intent_already_payed"
            : safeMessage,
          provider_response: payload,
          updated_at: new Date().toISOString(),
        })
        .eq("order_refund_id", recordId);
      return {
        requested: true,
        success: false,
        requiresManualRefundConfirmation,
        message: requiresManualRefundConfirmation
          ? "ONVO indica que este pago ya fue liquidado a la farmacia. Debes reembolsarlo manualmente y luego confirmarlo aquí."
          : `ONVO rechazó el reembolso: ${safeMessage}`,
      };
    }
    refund = payload as OnvoRefund;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("ONVO refund exception", { orderId: params.orderId, message });
    await admin
      .schema("mediasis")
      .from("order_refunds")
      .update({ status: "failed", failure_reason: "network_error", updated_at: new Date().toISOString() })
      .eq("order_refund_id", recordId);
    return { requested: true, success: false, message: "No se pudo contactar a ONVO para procesar el reembolso." };
  }

  const refundStatus = refund.status ?? "pending";
  const { error: persistError } = await updateRefundRecord(admin, recordId, refund, refundStatus);
  if (persistError) {
    console.error("Refund persistence failed", { orderId: params.orderId, code: persistError.code });
    return { requested: true, success: false, message: "ONVO respondió, pero no se pudo guardar el comprobante. No repitas el reembolso manualmente." };
  }

  if (refundStatus !== "succeeded") {
    return {
      requested: true,
      success: false,
      message: refundStatus === "failed"
        ? `El reembolso falló: ${refund.failureReason ?? "motivo no disponible"}`
        : "El reembolso está pendiente de confirmación en ONVO.",
    };
  }

  const reconciliationError = await finalizeOrder();
  if (reconciliationError) {
    console.error("Refund order reconciliation failed", {
      orderId: params.orderId,
      code: reconciliationError.code,
    });
    return {
      requested: true,
      success: false,
      message: "El reembolso fue exitoso, pero falta actualizar el estado local del pedido.",
    };
  }

  return { requested: true, success: true, message: "Pago de productos reembolsado." };
}

function minorAmountToDecimal(amount: number, minorUnitDigits: number) {
  const divisor = 10 ** minorUnitDigits;
  return (amount / divisor).toFixed(minorUnitDigits);
}

function decimalAmountToMinor(value: string, minorUnitDigits: number): number | null {
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || minorUnitDigits < 0 || minorUnitDigits > 6) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > minorUnitDigits) return null;
  const whole = Number(match[1]);
  const fractional = Number(fraction.padEnd(minorUnitDigits, "0") || "0");
  const amount = whole * (10 ** minorUnitDigits) + fractional;
  return Number.isSafeInteger(amount) ? amount : null;
}

function isTilopayRefundSucceeded(payload: unknown): payload is TilopayModification {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      String((payload as TilopayModification).ReasonCode ?? "") === TILOPAY_REFUND_SUCCESS_REASON_CODE,
  );
}

async function refundTilopayProductsPayment(params: {
  orderId: string;
  paymentIntentId: string | null;
  tilopayAccountId: string | null;
  userId: string;
  refundType: "full" | "partial";
  partialRefundAmount?: string;
}): Promise<OperationOutcome> {
  if (!params.paymentIntentId || !params.tilopayAccountId) {
    return { requested: true, success: false, message: "El pedido no tiene la información de Tilo Pay necesaria para reembolsar." };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("Tilo Pay refund admin client unavailable", {
      orderId: params.orderId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { requested: true, success: false, message: "El servidor no tiene configurado el acceso seguro para reembolsos." };
  }

  const finalizeOrder = async () => admin
    .schema("mediasis")
    .from("orders")
    .update({ products_payment_status: "refunded", order_status: "cancelled" })
    .eq("order_id", params.orderId);

  const { data: existing, error: existingError } = await admin
    .schema("mediasis")
    .from("order_refunds")
    .select("order_refund_id, provider_refund_id, status, provider_response, refund_kind")
    .eq("provider", "tilopay")
    .eq("payment_intent_id", params.paymentIntentId)
    .in("status", params.refundType === "full" ? ["creating", "pending", "succeeded"] : ["creating", "pending"])
    .eq("refund_kind", params.refundType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("Tilo Pay refund lookup failed", { orderId: params.orderId, code: existingError.code });
    return { requested: true, success: false, message: "No se pudo verificar el historial de reembolsos." };
  }
  if (params.refundType === "full" && existing?.status === "succeeded") {
    const { error } = await finalizeOrder();
    if (error) return { requested: true, success: false, message: "El pago ya fue reembolsado, pero falta actualizar el estado local del pedido." };
    return { requested: true, success: true, message: "El pago de productos ya fue reembolsado." };
  }
  if (existing?.status === "pending" && isTilopayRefundSucceeded(existing.provider_response)) {
    const { error: recordError } = await admin
      .schema("mediasis")
      .from("order_refunds")
      .update({ status: "succeeded", failure_reason: null, updated_at: new Date().toISOString() })
      .eq("order_refund_id", existing.order_refund_id);
    if (recordError) return { requested: true, success: false, message: "El reembolso fue aprobado por Tilo Pay, pero no se pudo actualizar su registro local." };

    const { error } = await finalizeOrder();
    if (error) return { requested: true, success: false, message: "El reembolso fue aprobado por Tilo Pay, pero falta actualizar el estado local del pedido." };
    return { requested: true, success: true, message: "Pago de productos reembolsado." };
  }
  if (existing) {
    return {
      requested: true,
      success: false,
      message: "Ya hay una solicitud de reembolso de Tilo Pay en proceso. Actualiza la página antes de volver a intentarlo.",
    };
  }

  const [{ data: payment, error: paymentError }, { data: account, error: accountError }] = await Promise.all([
    admin
      .schema("mediasis")
      .from("order_confirmation_state")
      .select("payment_provider, provider_order_reference, products_amount_cents, currency_code, currency_minor_unit_digits")
      .eq("order_id", params.orderId)
      .maybeSingle(),
    admin
      .schema("mediasis")
      .from("tilopay_accounts")
      .select("api_user, api_password, api_key, merchant_id, enabled")
      .eq("tilopay_account_id", params.tilopayAccountId)
      .eq("business_id", params.userId)
      .maybeSingle(),
  ]);

  if (
    paymentError || payment?.payment_provider !== "tilopay" || !payment.provider_order_reference ||
    payment.products_amount_cents == null || !payment.currency_code || payment.currency_minor_unit_digits == null
  ) {
    return { requested: true, success: false, message: "No se pudo verificar la referencia, monto o moneda del pago de Tilo Pay." };
  }
  if (accountError || !account?.enabled || !account.api_user || !account.api_password || !account.api_key) {
    return { requested: true, success: false, message: "No se pudo cargar la cuenta histórica de Tilo Pay del pedido." };
  }

  const { data: successfulRefunds, error: refundsError } = await admin
    .schema("mediasis")
    .from("order_refunds")
    .select("amount_minor")
    .eq("provider", "tilopay")
    .eq("payment_intent_id", params.paymentIntentId)
    .eq("status", "succeeded");
  if (refundsError) {
    return { requested: true, success: false, message: "No se pudo calcular el saldo reembolsable de Tilo Pay." };
  }
  const alreadyRefundedMinor = (successfulRefunds ?? []).reduce(
    (sum, refund) => sum + Math.max(0, refund.amount_minor ?? 0),
    0,
  );
  const remainingMinor = payment.products_amount_cents - alreadyRefundedMinor;
  if (remainingMinor <= 0) {
    return { requested: true, success: false, message: "Este pago ya no tiene saldo disponible para reembolsar." };
  }
  const requestedAmountMinor = params.refundType === "partial"
    ? decimalAmountToMinor(params.partialRefundAmount ?? "", payment.currency_minor_unit_digits)
    : remainingMinor;
  if (!requestedAmountMinor || requestedAmountMinor <= 0) {
    return { requested: true, success: false, message: "Ingresa un monto parcial válido mayor que cero." };
  }
  if (requestedAmountMinor > remainingMinor) {
    return { requested: true, success: false, message: `El monto supera el saldo reembolsable de ${minorAmountToDecimal(remainingMinor, payment.currency_minor_unit_digits)} ${payment.currency_code}.` };
  }
  if (params.refundType === "partial" && requestedAmountMinor === remainingMinor) {
    return { requested: true, success: false, message: "Para devolver todo el saldo, utiliza la opción de reembolso total." };
  }

  const { data: businessData } = await admin
    .schema("mediasis")
    .from("businesses")
    .select("full_name")
    .eq("uid", params.userId)
    .maybeSingle();
  const { data: created, error: createError } = await admin
    .schema("mediasis")
    .from("order_refunds")
    .insert({
      order_id: params.orderId,
      payment_intent_id: params.paymentIntentId,
      provider: "tilopay",
      refund_kind: params.refundType,
      amount_minor: requestedAmountMinor,
      currency: payment.currency_code,
      status: "creating",
      reason: "requested_by_customer",
      description: params.refundType === "partial" ? "Reembolso parcial del pedido" : "Pedido cancelado",
      initiated_by: params.userId,
      merchant_name: businessData?.full_name ?? null,
    })
    .select("order_refund_id")
    .single();
  if (createError || !created) {
    if (createError?.code === "23505") return { requested: true, success: false, message: "Ya hay un reembolso en proceso. Actualiza la página e inténtalo nuevamente." };
    console.error("Tilo Pay refund claim failed", { orderId: params.orderId, code: createError?.code });
    return { requested: true, success: false, message: "No se pudo iniciar el registro seguro del reembolso." };
  }

  try {
    const loginResponse = await fetch("https://app.tilopay.com/api/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiuser: account.api_user, password: account.api_password }),
    });
    const loginPayload = await loginResponse.json().catch(() => null) as { access_token?: string } | null;
    if (!loginResponse.ok || !loginPayload?.access_token) {
      console.error("Tilo Pay refund authentication failed", { orderId: params.orderId, status: loginResponse.status });
      await admin.schema("mediasis").from("order_refunds").update({ status: "failed", failure_reason: "authentication_failed", updated_at: new Date().toISOString() }).eq("order_refund_id", created.order_refund_id);
      return { requested: true, success: false, message: "Tilo Pay rechazó la autenticación para el reembolso." };
    }

    const response = await fetch("https://app.tilopay.com/api/v1/processModification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginPayload.access_token}` },
      body: JSON.stringify({
        orderNumber: payment.provider_order_reference,
        type: "2",
        amount: minorAmountToDecimal(requestedAmountMinor, payment.currency_minor_unit_digits),
        key: account.api_key,
      }),
    });
    const payload = await response.json().catch(() => null) as TilopayModification | null;
    console.info("Tilo Pay refund response", {
      orderId: params.orderId,
      status: response.status,
      transactionId: payload?.transactionId ?? null,
      reasonCode: payload?.ReasonCode ?? null,
      reasonCodeDescription: payload?.ReasonCodeDescription ?? null,
      type: payload?.type ?? null,
    });

    if (!response.ok) {
      const message = payload?.ReasonCodeDescription ?? `Tilo Pay HTTP ${response.status}`;
      await admin.schema("mediasis").from("order_refunds").update({ status: "failed", failure_reason: message, provider_response: payload, updated_at: new Date().toISOString() }).eq("order_refund_id", created.order_refund_id);
      return { requested: true, success: false, message: `Tilo Pay rechazó el reembolso: ${message}` };
    }

    const refundSucceeded = isTilopayRefundSucceeded(payload);
    await admin.schema("mediasis").from("order_refunds").update({
      provider_refund_id: payload?.transactionId != null ? String(payload.transactionId) : null,
      amount_minor: requestedAmountMinor,
      currency: payment.currency_code,
      status: refundSucceeded ? "succeeded" : "pending",
      reference_number: payment.provider_order_reference,
      transaction_reference: payload?.transactionId != null ? String(payload.transactionId) : null,
      provider_response: payload,
      updated_at: new Date().toISOString(),
    }).eq("order_refund_id", created.order_refund_id);
    if (!refundSucceeded) {
      return { requested: true, success: false, message: "Tilo Pay respondió al reembolso, pero no confirmó que fue aprobado. El resultado fue registrado y no se repetirá automáticamente." };
    }


    if (params.refundType === "partial") {
      const refundEventId = payload?.transactionId != null
        ? String(payload.transactionId)
        : created.order_refund_id;
      const { error: cashbackError } = await admin.schema("mediasis").rpc("adjust_cashback_for_refund", {
        p_order_id: params.orderId,
        p_refund_event_id: refundEventId,
        p_refunded_eligible_minor: requestedAmountMinor,
      });
      if (cashbackError) {
        console.error("Tilo Pay partial refund cashback adjustment failed", {
          orderId: params.orderId,
          code: cashbackError.code,
        });
      }
      return {
        requested: true,
        success: true,
        message: `Tilo Pay reembolsó ${minorAmountToDecimal(requestedAmountMinor, payment.currency_minor_unit_digits)} ${payment.currency_code}. El pedido permanece activo.`,
      };
    }

    const { error } = await finalizeOrder();
    if (error) return { requested: true, success: false, message: "El reembolso fue aprobado por Tilo Pay, pero falta actualizar el estado local del pedido." };
    return { requested: true, success: true, message: "Pago de productos reembolsado." };
  } catch (error) {
    console.error("Tilo Pay refund exception", { orderId: params.orderId, message: error instanceof Error ? error.message : "unknown" });
    // A timeout can happen after Tilo Pay accepted the refund, so keep the record open and block automatic retries.
    await admin.schema("mediasis").from("order_refunds").update({ status: "pending", failure_reason: "network_or_response_error", updated_at: new Date().toISOString() }).eq("order_refund_id", created.order_refund_id);
    return { requested: true, success: false, message: "No se pudo confirmar la respuesta de Tilo Pay. No repitas el reembolso hasta revisar el registro." };
  }
}

export async function getOrderRefunds(orderId: string): Promise<OrderRefundRecord[]> {
  const authorization = await verifyOrderOwner(orderId);
  if (!authorization.success) return [];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("mediasis")
      .from("order_refunds")
      .select(
        "order_refund_id, provider_refund_id, payment_intent_id, amount_minor, currency, refund_kind, status, reason, description, mode, failure_reason, provider_created_at, provider_updated_at, authorization_number, reference_number, transaction_reference, merchant_name, created_at",
      )
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Order refund read failed", { orderId, code: error.code });
      return [];
    }
    return (data ?? []) as OrderRefundRecord[];
  } catch (error) {
    console.error("Order refund admin client unavailable", {
      orderId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return [];
  }
}

export async function cancelOrderAction(
  orderId: string,
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  if (!input.cancelUber && !input.refundProducts) {
    return failureResult(input, "Selecciona al menos una acción.");
  }

  const authorization = await verifyOrderOwner(orderId);
  if (!authorization.success) return failureResult(input, authorization.message);

  const { supabase, userId, order } = authorization;
  const refundType = input.refundType ?? "full";
  if (order.order_status === "delivered" && !(input.refundProducts && refundType === "partial")) {
    return failureResult(input, "Este pedido ya fue entregado.");
  }

  let uber = emptyOutcome(input.cancelUber);
  let refund = emptyOutcome(input.refundProducts);
  const paymentType = await isSinpeOrder({
    supabase,
    businessPaymentMethodId: order.business_payment_method_id,
    userId,
  });
  if (!paymentType.success) {
    return failureResult(input, paymentType.message);
  }
  const sinpePayment = paymentType.isSinpe;

  if (input.refundProducts && sinpePayment && !input.sinpeRefundAcknowledged) {
    return failureResult(
      input,
      "Debes confirmar que el reembolso de SINPE fue realizado manualmente.",
    );
  }

  if (input.paidOutRefundAcknowledged && sinpePayment) {
    return failureResult(input, "Este pedido usa el flujo de reembolso manual de SINPE.");
  }
  if (refundType === "partial" && order.payment_provider !== "tilopay") {
    return failureResult(input, "Los reembolsos parciales están disponibles únicamente para pagos de Tilo Pay.");
  }
  if (refundType === "partial" && input.cancelUber) {
    return failureResult(input, "El reembolso parcial no puede combinarse con la cancelación del delivery.");
  }

  if (input.cancelUber) {
    uber = await cancelUberDelivery({
      supabase,
      userId,
      orderId,
      deliveryMethodId: order.delivery_method,
      cancelationReason: input.cancelationReason,
      additionalDescription: input.additionalDescription,
    });
  }

  if (input.refundProducts && uber.success) {
    refund = input.paidOutRefundAcknowledged
      ? await confirmManualPaidOutRefund({
          orderId,
          paymentIntentId: order.products_payment_intent_id,
        })
      : sinpePayment
      ? await confirmManualSinpeRefund({
          orderId,
          hasProductsPaymentIntent: Boolean(order.products_payment_intent_id),
          hasDeliveryPaymentIntent: Boolean(order.delivery_payment_intent_id),
        })
      : order.payment_provider === "tilopay"
      ? await refundTilopayProductsPayment({
          orderId,
          paymentIntentId: order.products_payment_intent_id,
          tilopayAccountId: order.tilopay_account_id,
          userId,
          refundType,
          partialRefundAmount: input.partialRefundAmount,
        })
      : order.payment_provider === "onvo"
      ? await refundProductsPayment({
          orderId,
          paymentIntentId: order.products_payment_intent_id,
          onvoKeysId: order.onvo_keys_id,
          userId,
        })
      : {
          requested: true,
          success: false,
          message: "El pedido no tiene un procesador de pago compatible para reembolsar.",
        };
  } else if (input.refundProducts) {
    refund = {
      requested: true,
      success: false,
      message: "El reembolso no se inició porque la cancelación de Uber falló.",
    };
  }

  let orderCancelled = false;
  if (input.refundProducts && refundType === "full" && refund.success && uber.success) {
    orderCancelled = true;
  }

  const success = uber.success && refund.success;
  const messages = [uber.message, refund.message].filter(Boolean);
  return {
    success,
    message: messages.join(" ") || (success ? "Operación completada." : "No se pudo completar la operación."),
    orderCancelled,
    uber,
    refund,
  };
}

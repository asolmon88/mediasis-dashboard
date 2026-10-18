const UBER_ERROR_TRANSLATIONS: Record<string, string> = {
  address_undeliverable:     "La dirección no está dentro del área de cobertura",
  no_couriers_available:     "Sin repartidores disponibles en este momento",
  pickup_deadline_too_soon:  "El plazo de recogida es muy corto",
  dropoff_deadline_too_soon: "El plazo de entrega es muy corto",
  invalid_pickup_window:     "Ventana de recogida inválida",
  delivery_expired:          "El delivery ha expirado",
  customer_suspended:        "Cuenta de Uber suspendida",
  rate_limited:              "Demasiadas solicitudes. Intenta de nuevo en un momento",
  unauthorized:              "Error de autenticación con Uber",
  invalid_params:            "Parámetros de solicitud inválidos",
};

export function translateUberError(errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody);
    const code = (parsed?.code ?? parsed?.status) as string | undefined;
    if (code && UBER_ERROR_TRANSLATIONS[code]) return UBER_ERROR_TRANSLATIONS[code];
    if (typeof parsed?.message === "string" && parsed.message) return parsed.message;
  } catch { /* not JSON — fall through */ }
  return errorBody;
}

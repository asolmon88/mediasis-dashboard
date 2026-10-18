export const mapOrderStatusToSpanish = (status: string) => {
  const mapping: Record<string, string> = {
    pending: "Pendiente",
    new: "Nueva",
    preparing: "Preparando",
    ready: "Lista",
    accepted: "Aceptada",
    delivered: "Entregada",
    cancelled: "Cancelada",
  };

  return mapping[status] ?? status;
};

export const mapOrderStatusToSpanish = (status: string) => {
  const mapping: Record<string, string> = {
    pending: "Pendiente",
    new: "Nueva",
    preparing: "Preparando",
    ready_for_pickup: "Lista para recoger",
    on_the_way: "En camino",
    ready: "Entregada",
    accepted: "Aceptada",
    delivered: "Entregada",
    cancelled: "Cancelada",
  };

  return mapping[status] ?? status;
};

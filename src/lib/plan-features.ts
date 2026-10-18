export type CatalogPlanKey = "lite" | "basic" | "uber";
export type PlanFeature = "cashback" | "meta_pixel" | "uber_delivery";

export const PLAN_FEATURES: Array<{ label: string; includedIn: CatalogPlanKey[] }> = [
  { label: "Panel de ventas — Administrá y controlá tus pedidos.", includedIn: ["lite", "basic", "uber"] },
  { label: "Personalizá tu propio linkapp de pedidos — Diseñá tu app en minutos.", includedIn: ["lite", "basic", "uber"] },
  { label: "Dominio personalizado — Comprá o conectá un dominio existente.", includedIn: ["lite", "basic", "uber"] },
  { label: "Códigos de descuento — Creá códigos de descuento para atraer clientes y aumentar tus ventas.", includedIn: ["lite", "basic", "uber"] },
  { label: "Pagos con tarjeta — Ofrecé una experiencia de compra rápida, fácil y segura.", includedIn: ["lite", "basic", "uber"] },
  { label: "Sistema de Cashback — Dale a tus clientes un % de cashback para que pidan por tu link.", includedIn: ["basic", "uber"] },
  { label: "Meta Pixel — Medí tus campañas y trackeá compras.", includedIn: ["basic", "uber"] },
  { label: "Conexión con Uber — Conectá la flotilla de Uber a tu propio link de pedidos.", includedIn: ["uber"] },
];

const featurePlans: Record<PlanFeature, CatalogPlanKey[]> = {
  cashback: ["basic", "uber"],
  meta_pixel: ["basic", "uber"],
  uber_delivery: ["uber"],
};

export function planIncludesFeature(planKey: string | null, feature: PlanFeature): boolean {
  const catalogKey = planKey === "uber_fijo" || planKey === "uber_porcentaje" ? "uber" : planKey;
  return featurePlans[feature].includes(catalogKey as CatalogPlanKey);
}

import { EditDeliveryMainPage } from "@/components/app/delivery/EditDeliveryMainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireDeliveryManagementAccess } from "@/lib/dashboard/delivery-authorization";
import type { DeliveryInput } from "@/lib/FormSchemas/deliverySchema";

type PageProps = { params: Promise<{ delivery_method_business_id: string }> };
const numberOrUndefined = (value: unknown) => value == null || Number.isNaN(Number(value)) ? undefined : Number(value);

export default async function EditDeliveryMethodPage({ params }: PageProps) {
  const authorized = await requireDeliveryManagementAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Delivery" description={authorized.message} />;
  }
  const { delivery_method_business_id } = await params;
  const [{ data: method, error }, { data: paymentRows }, { data: selectedRows }] = await Promise.all([
    authorized.admin.schema("mediasis").from("delivery_methods_business").select(
      "uid, name, visibility, instructions, fee, min_order_value, free_delivery_value, require_location, require_courier, scope, options, delivery_method_id, delivery_methods_business_location(business_location_id)"
    ).eq("uid", delivery_method_business_id).eq("business_id", authorized.businessId).maybeSingle(),
    authorized.admin.schema("mediasis").from("business_payment_method")
      .select("business_payment_method_id, payment_method:payment_method_id(name)").eq("business_id", authorized.businessId),
    authorized.admin.schema("mediasis").from("business_delivery_methods_payment")
      .select("business_payment_method_id").eq("business_delivery_method_id", delivery_method_business_id),
  ]);
  if (error || !method) return <div className="py-10 text-center">Método de delivery no encontrado.</div>;
  const allLocationIds = (method.delivery_methods_business_location as Array<{ business_location_id: string }> | null)
    ?.map((row) => row.business_location_id) ?? [];
  const visibleLocationIds = authorized.canManageAllLocations ? allLocationIds : allLocationIds.filter((id) => authorized.allowedLocationIds.has(id));
  const paymentMethods = (paymentRows ?? []).flatMap((row) => {
    const relation = Array.isArray(row.payment_method) ? row.payment_method[0] : row.payment_method;
    const name = relation?.name?.trim();
    return row.business_payment_method_id && name ? [{ id: row.business_payment_method_id, name }] : [];
  });
  const defaults: Partial<DeliveryInput> = {
    delivery_method_id: method.delivery_method_id ?? "", name: method.name ?? "", visibility: method.visibility ?? true,
    instructions: method.instructions ?? undefined,
    payment_methods: (selectedRows ?? []).map((row) => row.business_payment_method_id).filter(Boolean),
    fee: numberOrUndefined(method.fee), min_order_value: numberOrUndefined(method.min_order_value),
    free_delivery_value: numberOrUndefined(method.free_delivery_value), require_location: method.require_location ?? false,
    require_courier: method.require_courier ?? false, business_location_id: visibleLocationIds,
    options: (method.options as DeliveryInput["options"]) ?? undefined,
  };
  return <EditDeliveryMainPage recordId={method.uid} defaults={defaults} paymentMethods={paymentMethods}
    canManageAllLocations={authorized.canManageAllLocations}
    scopeLocked={!authorized.canManageAllLocations && method.scope === "all"}
    canUseMediasisCourier={authorized.canUseMediasisCourier} />;
}

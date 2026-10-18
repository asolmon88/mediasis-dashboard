import DeliveryMethodMainPage from "@/components/app/delivery/DeliveryMethodMainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireDeliveryManagementAccess } from "@/lib/dashboard/delivery-authorization";

type PageProps = { params: Promise<{ delivery_method_id: string }> };

export default async function DeliveryMethodPage({ params }: PageProps) {
  const authorized = await requireDeliveryManagementAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Delivery" description={authorized.message} />;
  }
  const { delivery_method_id } = await params;
  const [{ data: method, error: methodError }, { data: paymentRows, error: paymentError }] = await Promise.all([
    authorized.admin.schema("mediasis").from("delivery_methods")
      .select("id, name, visibility, require_location, require_courier").eq("id", delivery_method_id).maybeSingle(),
    authorized.admin.schema("mediasis").from("business_payment_method")
      .select("business_payment_method_id, payment_method:payment_method_id(name)").eq("business_id", authorized.businessId),
  ]);
  if (methodError || !method || paymentError) return <div className="py-10 text-center">Error al cargar la configuración de delivery.</div>;
  const paymentMethods = (paymentRows ?? []).flatMap((row) => {
    const relation = Array.isArray(row.payment_method) ? row.payment_method[0] : row.payment_method;
    const name = relation?.name?.trim();
    return row.business_payment_method_id && name ? [{ id: row.business_payment_method_id, name }] : [];
  });
  return <DeliveryMethodMainPage deliveryMethodId={delivery_method_id} defaults={{
    delivery_method_id, visibility: method.visibility ?? true,
    require_location: method.require_location ?? false, require_courier: method.require_courier ?? false,
    name: method.name ?? "", pickup_ready_offset_minutes: 5,
  }} paymentMethods={paymentMethods} canManageAllLocations={authorized.canManageAllLocations} canUseMediasisCourier={authorized.canUseMediasisCourier} />;
}

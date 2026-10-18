import MainPage from "@/components/app/delivery/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireDeliveryManagementAccess } from "@/lib/dashboard/delivery-authorization";
import type { delivery_methods_for_table } from "@/lib/types/dashboardTypes";

export default async function DeliveryPage() {
  const authorized = await requireDeliveryManagementAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Delivery" description={authorized.message} />;
  }
  const [{ data, error }, { data: templates, error: templatesError }] = await Promise.all([
    authorized.admin.schema("mediasis").from("delivery_methods_business")
      .select("name, instructions, visibility, uid").eq("business_id", authorized.businessId),
    authorized.admin.schema("mediasis").from("delivery_methods").select("id, name").order("name"),
  ]);
  if (error || templatesError) return <div className="flex items-center justify-center"><p>Error al cargar los métodos de delivery.</p></div>;
  return <MainPage delivery_methods={data as delivery_methods_for_table}
    predefinedMethods={(templates ?? []).flatMap((row) => row.id && row.name ? [{ value: row.id, label: row.name }] : [])} />;
}

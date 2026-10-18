import MainPage from "@/components/products-page/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";
import type { ProductView } from "@/lib/types/dashboardTypes";

export default async function ProductsPage() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Productos" description={authorized.message} />;
  }
  const { data: business } = await authorized.admin
    .schema("mediasis")
    .from("businesses")
    .select("app_active")
    .eq("uid", authorized.businessId)
    .maybeSingle();

  // Pharmacy accounts retain the historical activation gate. Mediasis staff
  // must be able to configure a newly provisioned business before launch.
  if (authorized.context.mode !== "staff" && !business?.app_active) {
    return <DashboardAccessDenied
      title="Productos no disponibles"
      description="La app de pedidos no está activa para este negocio."
    />;
  }
  const { data, error } = await authorized.admin.schema("mediasis").rpc(
    "get_products_for_dashboard",
    { p_business_id: authorized.businessId },
  );
  if (error) {
    console.error("[Mediasis products page] Unable to load products", {
      businessId: authorized.businessId,
      code: error.code,
      message: error.message,
    });
    return (
      <div className="flex justify-center items-center w-full">
        <p>No se pudieron cargar los productos.</p>
      </div>
    );
  }
  return <MainPage initialProducts={(data ?? []) as ProductView} />;
}

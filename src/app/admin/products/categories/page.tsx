import MainPage from "@/components/products-page/categories/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { getCurrentBusinessCategories } from "./actions";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";

export default async function CategoriesPage() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Categorías" description={authorized.message} />;
  }
  const { data: appAvailableData } = await authorized.admin.schema('mediasis').from('businesses').select('app_active').eq('uid', authorized.businessId).maybeSingle();

  if (authorized.context.mode !== "staff" && !appAvailableData?.app_active) {
    return <DashboardAccessDenied
      title="Categorías no disponibles"
      description="La app de pedidos no está activa para este negocio."
    />;
  }
  const result = await getCurrentBusinessCategories();

  if (!result.success) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Error al cargar las categorías, por favor recargue la página</p>
      </div>
    );
  }

  return (
    <div>
      <MainPage categories={result.data ?? []} />
    </div>
  );
}

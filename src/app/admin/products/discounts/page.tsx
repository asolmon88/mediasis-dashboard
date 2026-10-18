import MainPage from "@/components/products-page/discounts/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";
import { getCurrentBusinessDiscounts } from "./actions";
import { getDiscountTypeConfigList } from "./discount-type-config";

export default async function DiscountsPage() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Descuentos" description={authorized.message} />;
  }
  const { data: appAvailableData } = await authorized.admin
    .schema("mediasis")
    .from("businesses")
    .select("app_active")
    .eq("uid", authorized.businessId)
    .maybeSingle();

  if (authorized.context.mode !== "staff" && !appAvailableData?.app_active) {
    return <DashboardAccessDenied
      title="Descuentos no disponibles"
      description="La app de pedidos no está activa para este negocio."
    />;
  }

  const result = await getCurrentBusinessDiscounts();
  const discountTypeOptions = getDiscountTypeConfigList();

  if (!result.success) {
    return (
      <div className="flex flex-col justify-center items-center">
        <p>Error al cargar los descuentos, por favor recargue la página</p>
      </div>
    );
  }

  return (
    <div>
      <MainPage discounts={result.data ?? []} discountTypeOptions={discountTypeOptions} />
    </div>
  );
}

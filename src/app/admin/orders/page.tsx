import MainPage from "@/components/app/orders/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullOrdersAccess } from "@/lib/dashboard/order-authorization";

export default async function OrdersPage() {
  const authorized = await requireFullOrdersAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Órdenes" description={authorized.message} />;
  }
  return <MainPage />;
}

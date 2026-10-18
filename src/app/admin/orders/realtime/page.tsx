import MainPage from "@/components/app/orders/realtime/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullOrdersAccess } from "@/lib/dashboard/order-authorization";

export default async function OrdersRealtimePage() {
  const authorized = await requireFullOrdersAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Tiempo real" description={authorized.message} />;
  }
  return <MainPage />;
}

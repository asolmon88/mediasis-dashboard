import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";

export default async function ProductsLayout({ children }: { children: React.ReactNode }) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a Productos" description={authorized.message} />;
  }
  return children;
}

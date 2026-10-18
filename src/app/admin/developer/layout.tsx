import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireDeveloperManagementAccess } from "@/lib/dashboard/developer-authorization";

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const access = await requireDeveloperManagementAccess();
  if (!access.success) {
    return <DashboardAccessDenied title="Sin acceso a Desarrollador" description={access.message} />;
  }
  return children;
}

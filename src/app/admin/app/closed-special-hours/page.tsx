'use server';
import MainPage from "@/components/app/closed-special-hours/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireScheduleManagementAccess } from "@/lib/dashboard/schedule-authorization";

export default async function AppConfigPage() {
  const access = await requireScheduleManagementAccess();
  if (!access.success) {
    return (
      <DashboardAccessDenied
        title="Sin acceso a Horarios especiales"
        description={access.message}
      />
    );
  }

  return (
    <>
      <MainPage />
    </>
  )
}

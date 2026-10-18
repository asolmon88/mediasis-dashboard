import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { ReservationsUnavailable } from "@/components/reservations-page/ReservationsUnavailable";
import { requireReservationsManagementAccess } from "@/lib/dashboard/reservation-authorization";

export default async function ReservationsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireReservationsManagementAccess();
  if (!access.success) {
    return <DashboardAccessDenied title="Sin acceso a Reservaciones" description={access.message} />;
  }
  if (access.eligibleLocationIds.length === 0) return <ReservationsUnavailable />;
  return children;
}

import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { ReservationsUnavailable } from "@/components/reservations-page/ReservationsUnavailable";
import { requireReservationsManagementAccess } from "@/lib/dashboard/reservation-authorization";

export default async function ReservationClosedDaysLayout({children}:{children:React.ReactNode}){
  const access=await requireReservationsManagementAccess();
  if(!access.success) {
    return <DashboardAccessDenied title="Sin acceso a Días cerrados" description={access.message}/>;
  }
  if(access.eligibleLocationIds.length===0) return <ReservationsUnavailable/>;
  return children;
}

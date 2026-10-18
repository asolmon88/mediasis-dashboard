import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import ScheduleConfigForm from "@/components/locations/ScheduleConfigForm";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireScheduleManagementAccess } from "@/lib/dashboard/schedule-authorization";

export default async function SettingsPage() {
  const access = await requireScheduleManagementAccess();
  if (!access.success) {
    return (
      <DashboardAccessDenied
        title="Sin acceso a Horario"
        description={access.message}
      />
    );
  }

  return(
    <div className="flex flex-col p-4 min-h-screen justify-center items-center">
      <div className="h-full p-2 md:w-3/4 w-svw">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Configuración de los horarios</CardTitle>
            <CardDescription>Edite horarios de apertura</CardDescription>
          </CardHeader>
          <CardContent>
            <ScheduleConfigForm type="orders" canManageAllLocations={access.canManageAllLocations}/>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

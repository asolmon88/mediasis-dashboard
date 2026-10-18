import AutomaticStatusesForm from "@/components/dashboard-app/automatic-statuses/AutomaticStatusesForm";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { getAutomaticStatusSettings } from "./actions";

export default async function AutomaticStatusesPage() {
  const result = await getAutomaticStatusSettings();
  if (!result.success) {
    return <DashboardAccessDenied title="Sin acceso a Estados automáticos" description={result.message} />;
  }

  return (
    <AutomaticStatusesForm
      locations={result.locations}
      initialSettings={result.settings}
      canManageAllLocations={result.canManageAllLocations}
      globalConfigurationActive={result.globalConfigurationActive}
    />
  );
}

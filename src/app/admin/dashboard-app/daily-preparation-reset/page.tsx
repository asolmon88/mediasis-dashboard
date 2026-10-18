import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import DailyPreparationResetForm from "@/components/dashboard-app/daily-preparation-reset/DailyPreparationResetForm";
import { getDailyPreparationResetSettings } from "./actions";

export default async function DailyPreparationResetPage() {
  const result = await getDailyPreparationResetSettings();
  if (!result.success) {
    return <DashboardAccessDenied title="Reinicio diario de preparación no disponible" description={result.message} />;
  }

  return (
    <div className="px-4 py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Reinicio diario de preparación</h1>
          <p className="text-sm text-muted-foreground">
            Configurá los tiempos de preparación que se aplican al comenzar cada día en la zona horaria de tu negocio.
          </p>
        </div>
        <DailyPreparationResetForm initialSettings={result.settings} />
      </div>
    </div>
  );
}

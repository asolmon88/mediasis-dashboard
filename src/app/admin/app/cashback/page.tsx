import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { PlanUpgradePrompt } from "@/components/dashboard/PlanUpgradePrompt";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { getBusinessPlanEntitlements } from "@/lib/dashboard/plan-entitlements";
import { getPlanChangeQuote } from "@/app/admin/settings/billing/actions";
import CashbackSettingsForm from "./CashbackSettingsForm";
import { getOrderingAppCashbackSettings } from "./actions";

export default async function CashbackPage() {
  const context = await getDashboardAuthorizationContext();
  if (context?.activeBusinessId && context.mode !== "staff") {
    try {
      const plan = await getBusinessPlanEntitlements(context.activeBusinessId);
      if (plan.planKey === "lite") {
        const quote = context.mode === "clerk" ? await getPlanChangeQuote("plan", "basic") : null;
        return <PlanUpgradePrompt feature="Cashback" selfService={quote?.success === true} />;
      }
    } catch { return <DashboardAccessDenied description="No se pudo verificar el plan del negocio." />; }
  }
  const result = await getOrderingAppCashbackSettings();
  if (!result.success) {
    return <DashboardAccessDenied title="Sin acceso a Cashback" description={result.message} />;
  }
  return (
    <CashbackSettingsForm
      initialEnabled={result.enabled}
      initialPercentage={result.percentage}
    />
  );
}

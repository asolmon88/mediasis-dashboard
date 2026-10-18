import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { PlanUpgradePrompt } from "@/components/dashboard/PlanUpgradePrompt";
import { getPlanChangeQuote } from "@/app/admin/settings/billing/actions";
import { requireMetaPixelReadAccess } from "@/lib/dashboard/meta-pixel-authorization";
import { FacebookPixelCard } from "./facebook-pixel-card";

export default async function FacebookPixelPage() {
  const authorized = await requireMetaPixelReadAccess();
  if (!authorized.success) return <DashboardAccessDenied title="Facebook pixel no disponible" description={authorized.message} />;
  if (authorized.planKey === "lite" && authorized.context.mode !== "staff") {
    const quote = authorized.context.mode === "clerk" ? await getPlanChangeQuote("plan", "basic") : null;
    return <PlanUpgradePrompt feature="Meta Pixel" selfService={quote?.success === true} />;
  }
  const { data, error } = await authorized.admin.schema("mediasis").from("businesses").select("meta_pixel_id_orders, meta_token_orders").eq("uid", authorized.businessId).maybeSingle();
  if (error) return <DashboardAccessDenied title="Facebook pixel no disponible" description="No se pudo cargar la configuración de Facebook pixel." />;
  return <main className="mx-auto w-full max-w-3xl p-4 md:p-8"><FacebookPixelCard pixelId={data?.meta_pixel_id_orders ?? null} serverEventsConnected={Boolean(data?.meta_pixel_id_orders && data?.meta_token_orders)} canManage={authorized.canManage} /></main>;
}

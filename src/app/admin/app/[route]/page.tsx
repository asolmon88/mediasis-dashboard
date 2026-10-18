'use server';
import MainPage from "@/components/app/MainPage";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { getAuthorizedPreferredStorefrontLink } from "@/lib/dashboard/storefront-link";

export default async function AppConfigPage() {
  const authorized = await getAuthorizedPreferredStorefrontLink();
  if (!authorized.success) {
    return <DashboardAccessDenied title="Sin acceso a App de pedidos" description={authorized.message} />;
  }

  const { data: AppAvailableData } = await authorized.admin.schema('mediasis').from('businesses').select('app_active').eq('uid', authorized.businessId).maybeSingle();

  if (authorized.context.mode !== "staff" && !AppAvailableData?.app_active) {
    return <DashboardAccessDenied
      title="App de pedidos no disponible"
      description="La app de pedidos no está activa para este negocio."
    />;
  }

  return (
    <>
      <MainPage storefrontUrl={authorized.storefrontLink?.url} storefrontKind={authorized.storefrontLink?.kind}/>
    </>
  )
}

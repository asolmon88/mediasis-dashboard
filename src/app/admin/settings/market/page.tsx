import { MarketSettingsForm, } from "@/components/businesses/MarketSettingsForm";
import type { MarketCountryProfile } from "@/components/businesses/CreateBusinessForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function MarketSettingsPage() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) {
    return <DashboardAccessDenied title="Sin negocio activo" description="Seleccioná un negocio para consultar su configuración regional." />;
  }
  if (!context.market) {
    return <DashboardAccessDenied title="Configuración regional no disponible" description="No se pudo resolver el país y la configuración regional del negocio." />;
  }
  if (context.mode !== "legacy" && !hasDashboardPermission(context, "business.market_settings.read")) {
    return <DashboardAccessDenied title="Sin acceso a País y región" description="No tenés permiso para consultar la configuración regional." />;
  }
  const admin = createAdminClient();
  const { data: canCorrect } = context.mode === "staff" && context.appUserId
    ? await admin.schema("mediasis").rpc("staff_actor_has_permission", {
        p_actor_app_user_id: context.appUserId,
        p_permission_key: "businesses.market.correct",
      })
    : { data: false };
  const { data } = await admin.schema("mediasis").from("market_country_profiles")
    .select("country_code,country_name,default_timezone,default_currency_code,default_locale,phone_country_code,map_center_lat,map_center_lng,map_default_zoom")
    .eq("active", true).order("country_name");
  const profiles: MarketCountryProfile[] = (data ?? []).map((profile) => ({
    countryCode: profile.country_code, countryName: profile.country_name,
    timezone: profile.default_timezone, currencyCode: profile.default_currency_code,
    locale: profile.default_locale, phoneCountryCode: profile.phone_country_code,
    mapCenterLat: Number(profile.map_center_lat ?? 0), mapCenterLng: Number(profile.map_center_lng ?? 0),
    mapDefaultZoom: Number(profile.map_default_zoom ?? 9),
  }));
  return <div className="p-4 md:p-8"><Card className="mx-auto max-w-3xl">
    <CardHeader><CardTitle>País y configuración regional</CardTitle>
      <CardDescription>Un negocio opera en un solo país; todas sus ubicaciones heredan esta configuración.</CardDescription>
    </CardHeader><CardContent><MarketSettingsForm market={context.market} profiles={profiles} canCorrect={canCorrect === true} /></CardContent>
  </Card></div>;
}

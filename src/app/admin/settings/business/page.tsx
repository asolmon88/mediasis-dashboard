import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BusinessDeletionCard } from "./business-deletion-card";

export default async function BusinessSettingsPage() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId || !context.appUserId) return <DashboardAccessDenied title="Sin negocio activo" description="Seleccioná un negocio para administrar esta configuración." />;
  const admin = createAdminClient();
  const [{ data: business }, { data: owner }] = await Promise.all([
    admin.schema("mediasis").from("businesses").select("full_name").eq("uid", context.activeBusinessId).maybeSingle(),
    admin.schema("mediasis").from("business_account_owners").select("owner_app_user_id").eq("business_id", context.activeBusinessId).maybeSingle(),
  ]);
  if (!business || owner?.owner_app_user_id !== context.appUserId) return <DashboardAccessDenied title="Sin acceso a Negocio" description="Solo el propietario de la cuenta del negocio puede solicitar su eliminación." />;
  return <div className="p-4 md:p-8"><Card className="mx-auto max-w-3xl"><CardHeader><CardTitle>Negocio</CardTitle><CardDescription>Administrá las acciones críticas de {business.full_name}.</CardDescription></CardHeader><CardContent><BusinessDeletionCard businessName={business.full_name} /></CardContent></Card></div>;
}

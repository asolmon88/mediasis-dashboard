import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getPublicSignupCatalog, reconcileMerchantOnboarding } from "@/lib/dashboard/merchant-onboarding";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardPlansCatalog } from "./plans-catalog";

export default async function DashboardPlansPage() {
  const session = await auth();
  if (!session.userId) redirect("/clerk-auth/sign-in?redirect_url=/clerk-auth/plans");
  const onboarding = await reconcileMerchantOnboarding();
  if (onboarding?.status === "onboarding") redirect("/clerk-auth/onboarding");
  const authorization = await getDashboardAuthorizationContext();
  if (authorization?.businesses.length) redirect("/admin");
  // An authorization problem is not proof that this account has no business.
  // Do not offer a plan that the create action will then reject.
  const admin = createAdminClient();
  const { data: identity, error: identityError } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id").eq("clerk_user_id", session.userId).maybeSingle();
  if (identityError || !identity?.app_user_id) {
    return <main className="flex min-h-svh items-center justify-center p-6 text-center">No se pudo verificar tu acceso. Volvé a intentarlo más tarde.</main>;
  }
  if (identity.app_user_id) {
    const { count, error } = await admin.schema("mediasis").from("business_memberships")
      .select("business_id,businesses!inner(active)", { count: "exact", head: true })
      .eq("app_user_id", identity.app_user_id).eq("status", "active").is("revoked_at", null)
      .eq("businesses.active", true);
    if (error || (count ?? 0) > 0) {
      return <main className="flex min-h-svh items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-xl font-semibold">No se pudo abrir tu negocio</h1>
          <p className="text-muted-foreground">Tu cuenta ya tiene un negocio. Volvé a intentar entrar al panel o contactá al equipo de Mediasis si el problema continúa.</p>
          <a className="text-blue-600 underline" href="/admin">Volver al panel</a>
        </div>
      </main>;
    }
  }
  return <DashboardPlansCatalog catalog={await getPublicSignupCatalog()} />;
}

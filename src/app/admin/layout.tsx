import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "../globals.css";

import { DashboardClerkProvider } from "@/components/auth/DashboardClerkProvider";
import { DashboardAuthProvider } from "@/components/dashboard/DashboardAuthProvider";
import { AppSidebar } from "@/components/app-sidebar";
import { LockedSubscriptionPanel } from "@/components/dashboard/LockedSubscriptionPanel";
import { RecoveryButton } from "@/app/(home)/clerk-auth/subscription-required/RecoveryButton";
import { CancellationFeePanel } from "@/components/dashboard/CancellationFeePanel";
import DashboardTitle from "@/components/DashboardTitle";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { reconcileMerchantOnboarding } from "@/lib/dashboard/merchant-onboarding";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LocationStoreProvider } from "@/stores/location-store";
import { ChatwootSupport } from "@/components/support/ChatwootSupport";
import { declineMessage, type BillingDeclineCategory } from "@/lib/onvo/billing-decline";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Mediasis",
  description: "Gestione sus operaciones en línea",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let billingLock: "trial_expired" | "subscription_required" | null = null;
  let lockAmount: string | null = null;
  let lockCanPay = false;
  let renewalGraceEndsAt: string | null = null;
  let renewalAuthenticationPending = false;
  let renewalCanPay = false;
  let renewalDecline: string | null = null;
  let cancellationEnded = false;
  let cancellationFeeAmount: string | null = null;
  let cancellationFeeExists = false;
  let cancellationEndedAt: string | null = null;
  const onboarding = await reconcileMerchantOnboarding();
  if (onboarding?.status === "onboarding") redirect("/clerk-auth/onboarding");
  const authorization = await getDashboardAuthorizationContext();
  // An authenticated order-app user has a valid Mediasis identity but no
  // dashboard membership yet. Give that account a plan-first entry point
  // instead of treating it as an authorization failure.
  if (!authorization) {
    const session = await auth();
    if (session.userId) redirect("/clerk-auth/plans");
  }
  if (authorization?.pendingOnboardingBusinessId) {
    if (authorization.businessState?.subscription_owner_id === authorization.appUserId) {
      redirect(`/clerk-auth/onboarding/payment?business=${authorization.pendingOnboardingBusinessId}`);
    }
    redirect("/clerk-auth/onboarding");
  }
  if (authorization?.activeBusinessId && authorization.mode !== "staff") {
    const state = authorization.businessState;
    if (state?.subscription_status === "suspended") billingLock = "subscription_required";
    cancellationEnded = Boolean(state?.cancellation_requested_at && state.cancel_at
      && new Date(state.cancel_at).getTime() <= Date.now());
    if (cancellationEnded) {
      cancellationEndedAt = state?.cancel_at ?? null;
      const fee = state?.cancellation_fee;
      cancellationFeeExists = Boolean(fee);
      if (fee) cancellationFeeAmount = new Intl.NumberFormat("en-US", { style: "currency", currency: fee.currency_code })
        .format(Number(fee.amount_minor) / 100);
      billingLock = "subscription_required";
    }
    if (state?.subscription_status === "past_due" && state.grace_ends_at) {
      renewalGraceEndsAt = state.grace_ends_at;
      renewalCanPay = state.subscription_owner_id === authorization.appUserId;
      if (state.renewal_failure_category)
        renewalDecline = declineMessage(state.renewal_failure_category as BillingDeclineCategory);
    }
    if (state?.subscription_status === "active") {
      renewalAuthenticationPending = state.renewal_pending;
      if (renewalAuthenticationPending) renewalCanPay = state.subscription_owner_id === authorization.appUserId;
    }
    if (state?.amount_minor != null && state.currency_code) {
      lockAmount = new Intl.NumberFormat("en-US", { style: "currency", currency: state.currency_code })
        .format(Number(state.amount_minor) / 100);
    }
    lockCanPay = state?.account_owner_id === authorization.appUserId;
    // A self-service plan is never allowed to bypass payment setup merely
    // because it was created before the Onvo card table existed. The selected
    // business and its account owner are checked here, not an unrelated first
    // onboarding record.
    const isAccountOwner = state?.account_owner_id === authorization.appUserId;
    const activeLegacyTrial = state?.trial_status === "active" && !!state.trial_ends_at && new Date(state.trial_ends_at).getTime() > Date.now();
    if (["lite", "basic"].includes(state?.plan_key ?? "") && !state?.has_onvo_card && isAccountOwner
      && (["awaiting_card", "trialing", "active", "past_due"].includes(state?.subscription_status ?? "") || activeLegacyTrial)) {
      redirect(`/clerk-auth/onboarding/payment?business=${authorization.activeBusinessId}`);
    }
    if (!billingLock && state && (state.trial_status === "expired" || state.trial_status === "cancelled"
      || (state.trial_status === "active" && state.trial_ends_at && new Date(state.trial_ends_at).getTime() <= Date.now()))) {
      billingLock = "trial_expired";
    }
  }

  return (
    <html lang="es" suppressHydrationWarning className={poppins.variable}>
      <body className="antialiased">
        <DashboardClerkProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {authorization ? (
              <DashboardAuthProvider value={authorization}>
                <LocationStoreProvider initialLocations={authorization.locations}>
                  <SidebarProvider style={{ "--sidebar-width": "17.5rem" } as React.CSSProperties}>
                    <AppSidebar billingLocked={Boolean(billingLock)} className="border-r border-sidebar-border/80" />
                    <SidebarInset className="min-w-0 bg-background">
                      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center border-b border-border/70 bg-background/90 px-4 backdrop-blur-xl md:h-16 lg:px-7">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <SidebarTrigger className="-ml-1 size-9 rounded-xl border bg-card shadow-sm" />
                          <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
                          <DashboardTitle />
                        </div>
                      </header>
                      {(renewalGraceEndsAt || renewalAuthenticationPending) && authorization.activeBusinessId ? <section role="alert" className={`m-4 flex flex-col items-center justify-center gap-3 rounded-xl border p-4 text-center lg:mx-7 lg:flex-row lg:gap-6 lg:text-left ${renewalGraceEndsAt ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
                        <div className="min-w-0 shrink-0">
                          <h2 className="text-base font-semibold">{renewalGraceEndsAt ? "No pudimos cobrar la renovación" : "Tu renovación necesita verificación"}</h2>
                          {renewalGraceEndsAt ? <p className="mt-1 text-sm">Acceso hasta el {new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Costa_Rica" }).format(new Date(renewalGraceEndsAt))}.</p> : null}
                          {renewalDecline ? <p className="mt-1 text-sm font-semibold">{renewalDecline}</p> : null}
                        </div>
                        {renewalCanPay ? <RecoveryButton businessId={authorization.activeBusinessId} mode="grace" />
                          : <p className="text-sm font-medium">Solo el propietario puede completar el pago.</p>}
                      </section> : null}
                      {cancellationEnded && authorization.activeBusinessId ? <CancellationFeePanel
                        businessId={authorization.activeBusinessId} canPay={lockCanPay}
                        hasFee={cancellationFeeExists} amount={cancellationFeeAmount} dueAt={cancellationEndedAt}
                      /> : billingLock && authorization.activeBusinessId ? <LockedSubscriptionPanel
                        businessId={authorization.activeBusinessId}
                        businessName={authorization.businesses.find((business) => business.businessId === authorization.activeBusinessId)?.name ?? "tu negocio"}
                        amount={lockAmount} reason={billingLock} canPay={lockCanPay}
                      /> : children}
                    </SidebarInset>
                  </SidebarProvider>
                </LocationStoreProvider>
              </DashboardAuthProvider>
            ) : (
              <main className="flex min-h-svh items-center justify-center p-6 text-center">
                <div className="max-w-md space-y-2">
                  <h1 className="text-xl font-semibold">No se pudo validar tu acceso</h1>
                  <p className="text-muted-foreground">Iniciá sesión nuevamente o contactá al equipo de Mediasis.</p>
                </div>
              </main>
            )}
            <Toaster position="bottom-center" richColors />
            <ChatwootSupport />
          </ThemeProvider>
        </DashboardClerkProvider>
      </body>
    </html>
  );
}

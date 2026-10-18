import { RecoveryButton } from "@/app/(home)/clerk-auth/subscription-required/RecoveryButton";

export function LockedSubscriptionPanel({ businessId, businessName, amount, reason, canPay }: {
  businessId: string;
  businessName: string;
  amount: string | null;
  reason: "trial_expired" | "subscription_required";
  canPay: boolean;
}) {
  return <main className="flex min-h-[calc(100svh-4rem)] items-center justify-center bg-[#f6f8fc] p-5">
    <section className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
      <p className="text-sm font-bold text-[#0067ff]">mediasis</p>
      <h1 className="mt-5 text-3xl font-semibold text-slate-950">
        {reason === "trial_expired" ? "Terminó tu prueba gratis" : "Tu suscripción necesita atención"}
      </h1>
      <p className="mt-4 leading-7 text-slate-600">
        El panel y la app de pedidos de {businessName} están pausados. Tus datos siguen guardados.
        {amount ? ` El pago pendiente es de ${amount}.` : ""}
      </p>
      {canPay ? <div className="mt-7"><RecoveryButton businessId={businessId} /></div>
        : <p className="mt-7 text-sm text-slate-600">Solo el propietario puede completar el pago. Podés cambiar a otro negocio desde el menú de tu usuario.</p>}
      <p className="mt-5 text-sm text-slate-600">Si tenés otro negocio activo, cambialo desde el menú de la barra lateral.</p>
    </section>
  </main>;
}

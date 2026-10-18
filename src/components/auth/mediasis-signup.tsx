"use client";

import { useAuth, useSignUp } from "@clerk/nextjs";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LoaderCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";

import { saveMerchantSignupOffer } from "@/app/(home)/clerk-auth/get-started/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { MediasisPlanCatalog } from "@/components/auth/MediasisPlanCatalog";
import type { SignupCountry, SignupPlan } from "@/lib/dashboard/merchant-onboarding";

type Catalog = { countries: SignupCountry[]; plans: SignupPlan[] };
type Step = "plans" | "account" | "verification";
type BillingCadence = "monthly" | "annual";
const selectionKey = "mediasis-merchant-signup-selection-v1";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function clerkErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "errors" in error) {
    const first = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors?.[0];
    if (first?.longMessage || first?.message) return first.longMessage ?? first.message ?? "No se pudo completar el registro.";
  }
  return error instanceof Error ? error.message : "No se pudo completar el registro. Intentá de nuevo.";
}

export function MediasisSignup({ catalog }: { catalog: Catalog }) {
  const { signUp } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("plans");
  const [countryCode, setCountryCode] = useState(catalog.countries[0]?.countryCode ?? "");
  const [planKey, setPlanKey] = useState("");
  const [billingCadence, setBillingCadence] = useState<BillingCadence>("monthly");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const country = catalog.countries.find((item) => item.countryCode === countryCode);
  const selectedPlan = catalog.plans.find((item) => item.key === planKey);

  useEffect(() => {
    if (isSignedIn) router.replace("/clerk-auth/onboarding");
  }, [isSignedIn, router]);
  useEffect(() => {
    const metadata = signUp?.unsafeMetadata?.mediasisMerchantSignup as { countryCode?: string; planKey?: string; billingCadence?: BillingCadence } | undefined;
    const stored = (() => { try { return JSON.parse(sessionStorage.getItem(selectionKey) ?? "null") as { countryCode?: string; planKey?: string; billingCadence?: BillingCadence; email?: string } | null; } catch { return null; } })();
    const recoveredCountry = metadata?.countryCode ?? stored?.countryCode;
    const recoveredPlan = metadata?.planKey ?? stored?.planKey;
    if (recoveredCountry && catalog.countries.some((item) => item.countryCode === recoveredCountry)) setCountryCode(recoveredCountry);
    if (recoveredPlan && catalog.plans.some((item) => item.key === recoveredPlan)) setPlanKey(recoveredPlan);
    if (metadata?.billingCadence === "monthly" || metadata?.billingCadence === "annual") setBillingCadence(metadata.billingCadence);
    else if (stored?.billingCadence === "monthly" || stored?.billingCadence === "annual") setBillingCadence(stored.billingCadence);
    if (signUp?.emailAddress || stored?.email) setEmail(signUp?.emailAddress ?? stored?.email ?? "");
    if (signUp?.status === "complete") {
      void signUp.finalize().then(({ error: finalError }) => { if (!finalError) router.replace("/clerk-auth/onboarding"); else setError(clerkErrorMessage(finalError)); });
    } else if (signUp?.status === "missing_requirements" && signUp.hasPassword && signUp.unverifiedFields.includes("email_address")) {
      setStep("verification");
    }
  }, [signUp?.id, signUp?.status, signUp?.emailAddress, signUp?.hasPassword, catalog.countries, catalog.plans, router]);

  const choosePlan = (key: string) => {
    if (!catalog.plans.some((item) => item.key === key)) return;
    setPlanKey(key); setError(null); setStep("account");
    sessionStorage.setItem(selectionKey, JSON.stringify({ countryCode, planKey: key, billingCadence }));
  };
  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null);
    if (!country || !selectedPlan) return setError("Elegí un país y un plan para continuar.");
    if (!emailPattern.test(email.trim())) return setError("Ingresá un correo electrónico válido.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirmation) return setError("Las contraseñas no coinciden.");
    if (!signUp) return setError("El registro todavía no está disponible. Recargá la página.");
    setBusy(true);
    try {
      const displayedPrice = selectedPlan.prices[selectedPlan.billingCurrencyCode ?? country.currencyCode];
      const displayedFixedFeeMinor = billingCadence === "annual"
        ? displayedPrice?.annualMinor : displayedPrice?.monthlyMinor;
      if (displayedFixedFeeMinor == null) throw new Error("El precio seleccionado no está disponible.");
      const offerId = await saveMerchantSignupOffer({
        email: email.trim(), countryCode, planKey, billingCadence, displayedFixedFeeMinor,
      });
      sessionStorage.setItem(selectionKey, JSON.stringify({ countryCode, planKey, billingCadence, email: email.trim() }));
      const { error: signupError } = await signUp.password({
        emailAddress: email.trim(), password,
        unsafeMetadata: { mediasisMerchantSignup: { version: 1, countryCode, planKey, billingCadence, offerId } },
      });
      if (signupError) throw signupError;
      setPassword(""); setConfirmation("");
      if (signUp.status === "complete") {
        const { error: finalError } = await signUp.finalize();
        if (finalError) throw finalError;
        router.replace("/clerk-auth/onboarding");
        return;
      }
      if (!signUp.unverifiedFields.includes("email_address")) throw new Error("Clerk solicita un paso adicional de registro. Contactá a Mediasis.");
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) throw sendError;
      setStep("verification");
    } catch (cause) { setError(clerkErrorMessage(cause)); } finally { setBusy(false); }
  };
  const verifyEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null);
    if (code.length !== 6) return setError("Ingresá los seis dígitos del código.");
    if (!signUp) return;
    setBusy(true);
    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
      if (verifyError) throw verifyError;
      if (signUp.status !== "complete") throw new Error("El registro requiere un paso adicional. Contactá a Mediasis.");
      const { error: finalError } = await signUp.finalize();
      if (finalError) throw finalError;
      sessionStorage.removeItem(selectionKey);
      router.replace("/clerk-auth/onboarding");
    } catch (cause) { setError(clerkErrorMessage(cause)); } finally { setBusy(false); }
  };
  const resendCode = async () => {
    if (!signUp) return;
    setBusy(true); setError(null);
    try { const { error: sendError } = await signUp.verifications.sendEmailCode(); if (sendError) throw sendError; }
    catch (cause) { setError(clerkErrorMessage(cause)); } finally { setBusy(false); }
  };

  return <main className={step === "plans" ? "min-h-svh bg-[#02050c] text-slate-950" : "min-h-svh bg-[#f6f8fc] px-4 py-8 text-slate-950 sm:px-6 lg:py-12"}>
    <div className={step === "plans" ? "" : "mx-auto max-w-6xl"}>
      {step === "plans" ? <MediasisPlanCatalog catalog={catalog} countryCode={countryCode} billingCadence={billingCadence} onCountryChange={(nextCountryCode) => { setCountryCode(nextCountryCode); setError(null); }} onCadenceChange={setBillingCadence} onSelectPlan={choosePlan} error={error} surface="standalone" signInHref="/clerk-auth/sign-in" /> : <section className="mx-auto mt-12 max-w-md rounded-[28px] border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <button type="button" onClick={() => { if (step === "account") setStep("plans"); else setStep("account"); setError(null); }} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"><ArrowLeft className="size-4" />Volver</button>
        <h1 className="mt-7 text-3xl font-semibold">{step === "account" ? "Creá tu cuenta" : "Verificá tu correo"}</h1>
        {step === "account" ? <div className="mt-3 space-y-1 text-sm leading-6 text-slate-600"><p className="font-semibold text-slate-800">{selectedPlan?.name ?? "Tu plan"} · {country?.name ?? "Tu país"} · {billingCadence === "annual" ? "facturación anual" : "facturación mensual"} · 7 días gratis</p><p>Después continuarás con la creación de tu negocio.</p></div> : <p className="mt-3 text-sm leading-6 text-slate-600">{`Ingresá el código enviado a ${email}.`}</p>}
        {step === "account" ? <form onSubmit={createAccount} noValidate className="mt-8 space-y-5">
          <div><label htmlFor="signup-email" className="mb-2 block text-sm font-semibold">Correo electrónico</label><Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className="h-12 rounded-xl focus-visible:border-[#0067ff] focus-visible:ring-[#0067ff]/25" /></div>
          <div><label htmlFor="signup-password" className="mb-2 block text-sm font-semibold">Contraseña</label><div className="relative"><Input id="signup-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className="h-12 rounded-xl pr-12 focus-visible:border-[#0067ff] focus-visible:ring-[#0067ff]/25" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div><p className="mt-1 text-xs text-slate-500">Mínimo 8 caracteres.</p></div>
          <div><label htmlFor="signup-confirm" className="mb-2 block text-sm font-semibold">Confirmá tu contraseña</label><Input id="signup-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} className="h-12 rounded-xl focus-visible:border-[#0067ff] focus-visible:ring-[#0067ff]/25" /></div>
          <div id="clerk-captcha" />
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}<Button type="submit" disabled={busy} className="h-12 w-full rounded-xl bg-[#0067ff] font-semibold text-white hover:bg-[#0059dc]">{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}Crear cuenta</Button>
        </form> : <form onSubmit={verifyEmail} className="mt-8 space-y-6"><div><label htmlFor="signup-code" className="mb-3 block text-sm font-semibold">Código de verificación</label><InputOTP id="signup-code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={code} onChange={setCode} disabled={busy} autoComplete="one-time-code" containerClassName="justify-center gap-2"><InputOTPGroup>{[0,1,2].map((index) => <InputOTPSlot key={index} index={index} className="size-11 rounded-lg border-slate-200 data-[active=true]:border-[#0067ff] data-[active=true]:ring-[#0067ff]/25" />)}</InputOTPGroup><InputOTPSeparator /><InputOTPGroup>{[3,4,5].map((index) => <InputOTPSlot key={index} index={index} className="size-11 rounded-lg border-slate-200 data-[active=true]:border-[#0067ff] data-[active=true]:ring-[#0067ff]/25" />)}</InputOTPGroup></InputOTP></div>
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}<Button type="submit" disabled={busy} className="h-12 w-full rounded-xl bg-[#0067ff] font-semibold text-white hover:bg-[#0059dc]">{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}Verificar correo</Button><button type="button" onClick={resendCode} disabled={busy} className="block w-full text-center text-sm font-medium text-[#0067ff] hover:underline">Reenviar código</button>
        </form>}
      </section>}
    </div>
  </main>;
}

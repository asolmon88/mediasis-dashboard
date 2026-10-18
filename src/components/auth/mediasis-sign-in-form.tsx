"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

type View = "sign-in" | "forgot-password" | "recovery-code" | "verification" | "new-password" | "protect-check";
type FormErrors = Partial<Record<"email" | "password" | "code" | "confirmPassword", string>>;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClerkErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "errors" in error) {
    const firstError = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors?.[0];
    if (firstError?.longMessage || firstError?.message) return firstError.longMessage ?? firstError.message ?? "No pudimos completar la solicitud.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "No pudimos completar la solicitud. Revisá tus datos e intentá de nuevo.";
}

function safeDashboardRedirect(value: string | null) {
  return value?.startsWith("/admin") && !value.startsWith("//") ? value : "/admin";
}

function PasswordField({ id, label, value, onChange, error, disabled, autoComplete = "current-password" }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean; autoComplete?: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="space-y-2">
    <label className="text-sm font-medium text-slate-800" htmlFor={id}>{label}</label>
    <div className="relative">
      <Input id={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="h-12 rounded-xl border-slate-200 bg-white px-4 pr-12 text-slate-950 shadow-none placeholder:text-slate-400 focus-visible:border-[#0067ff] focus-visible:ring-[#0067ff]/25" />
      <button type="button" onClick={() => setVisible((current) => !current)} disabled={disabled} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 outline-none transition-colors hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-[#0067ff] disabled:cursor-not-allowed disabled:opacity-50" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}>
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
    {error ? <p id={`${id}-error`} className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
  </div>;
}

function OtpField({ id, value, onChange, error, disabled }: { id: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean }) {
  const slotClass = "h-12 w-10 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-950 first:rounded-xl last:rounded-xl data-[active=true]:border-[#0067ff] data-[active=true]:ring-[#0067ff]/25";
  return <>
    <InputOTP id={id} maxLength={6} value={value} onChange={onChange} pattern={REGEXP_ONLY_DIGITS} disabled={disabled} autoComplete="one-time-code" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} containerClassName="justify-center gap-3 sm:gap-4">
      <InputOTPGroup className="gap-2"><InputOTPSlot index={0} className={slotClass} /><InputOTPSlot index={1} className={slotClass} /><InputOTPSlot index={2} className={slotClass} /></InputOTPGroup>
      <InputOTPSeparator className="text-slate-400 [&_svg]:size-4" />
      <InputOTPGroup className="gap-2"><InputOTPSlot index={3} className={slotClass} /><InputOTPSlot index={4} className={slotClass} /><InputOTPSlot index={5} className={slotClass} /></InputOTPGroup>
    </InputOTP>
    {error ? <p id={`${id}-error`} className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
  </>;
}

export function MediasisSignInForm() {
  const { signIn } = useSignIn();
  const isLoaded = Boolean(signIn);
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = useMemo(() => safeDashboardRedirect(searchParams.get("redirect_url")), [searchParams]);
  const [view, setView] = useState<View>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verificationStrategy, setVerificationStrategy] = useState<"email_code" | "phone_code" | "totp" | "backup_code" | null>(null);
  const [verificationDestination, setVerificationDestination] = useState<string | null>(null);

  useEffect(() => { if (isSignedIn) router.replace(redirectTo); }, [isSignedIn, redirectTo, router]);
  const resetMessages = () => { setErrors({}); setFormError(null); };
  const activateSession = async () => {
    if (!signIn) throw new Error("No se pudo iniciar la sesión. Intentá de nuevo.");
    const { error } = await signIn.finalize();
    if (error) throw error;
    router.replace(redirectTo);
  };
  const startVerification = async (attempt: NonNullable<typeof signIn>) => {
    const factor = attempt.supportedSecondFactors.find((item) => item.strategy === "email_code") ?? attempt.supportedSecondFactors.find((item) => item.strategy === "phone_code") ?? attempt.supportedSecondFactors.find((item) => item.strategy === "totp") ?? attempt.supportedSecondFactors.find((item) => item.strategy === "backup_code");
    if (!factor) { setFormError("Esta cuenta necesita una verificación que todavía no está disponible en este dispositivo."); return; }
    if (factor.strategy === "email_code") { const { error } = await attempt.mfa.sendEmailCode(); if (error) throw error; setVerificationDestination(factor.safeIdentifier); }
    else if (factor.strategy === "phone_code") { const { error } = await attempt.mfa.sendPhoneCode(); if (error) throw error; setVerificationDestination(factor.safeIdentifier); }
    else setVerificationDestination(null);
    setVerificationStrategy(factor.strategy); setCode(""); setView("verification");
  };
  const continueSignIn = async (attempt: NonNullable<typeof signIn>) => {
    if (attempt.status === "complete") return activateSession();
    if (attempt.status === "needs_second_factor" || attempt.status === "needs_client_trust") return startVerification(attempt);
    if (attempt.status === "needs_new_password") { setView("new-password"); return; }
    if (attempt.status === "needs_protect_check") { setView("protect-check"); return; }
    setFormError("No pudimos completar el inicio de sesión. Intentá de nuevo.");
  };
  const submitSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); resetMessages(); const nextErrors: FormErrors = {};
    if (!emailPattern.test(email.trim())) nextErrors.email = "Ingresá un correo electrónico válido.";
    if (!password) nextErrors.password = "Ingresá tu contraseña.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    if (!signIn) return; setIsSubmitting(true);
    try { const { error } = await signIn.password({ identifier: email.trim(), password }); if (error) throw error; await continueSignIn(signIn); } catch (error) { setFormError(getClerkErrorMessage(error)); } finally { setIsSubmitting(false); }
  };
  const submitRecoveryRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); resetMessages(); if (!emailPattern.test(email.trim())) { setErrors({ email: "Ingresá un correo electrónico válido." }); return; }
    if (!signIn) return; setIsSubmitting(true);
    try {
      const { error: createError } = await signIn.create({ identifier: email.trim() });
      if (createError) throw createError;
      const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendError) throw sendError;
      setCode(""); setPassword(""); setConfirmPassword(""); setView("recovery-code");
    } catch (error) { setFormError(getClerkErrorMessage(error)); } finally { setIsSubmitting(false); }
  };
  const validateNewPassword = () => {
    const nextErrors: FormErrors = {};
    if (password.length < 8) nextErrors.password = "La contraseña debe tener al menos 8 caracteres.";
    if (password !== confirmPassword) nextErrors.confirmPassword = "Las contraseñas no coinciden.";
    setErrors(nextErrors); return Object.keys(nextErrors).length === 0;
  };
  const submitRecoveryCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); resetMessages(); if (!code.trim()) { setErrors({ code: "Ingresá el código que enviamos a tu correo." }); return; }
    if (!signIn) return; setIsSubmitting(true);
    try { const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() }); if (error) throw error; await continueSignIn(signIn); } catch (error) { setFormError(getClerkErrorMessage(error)); } finally { setIsSubmitting(false); }
  };
  const submitNewPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); resetMessages(); if (!validateNewPassword() || !signIn) return; setIsSubmitting(true);
    try { const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password }); if (error) throw error; await continueSignIn(signIn); } catch (error) { setFormError(getClerkErrorMessage(error)); } finally { setIsSubmitting(false); }
  };
  const submitVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); resetMessages(); if (!code.trim()) { setErrors({ code: "Ingresá tu código de verificación." }); return; }
    if (!signIn || !verificationStrategy) return; setIsSubmitting(true);
    try {
      const { error } = verificationStrategy === "email_code" ? await signIn.mfa.verifyEmailCode({ code: code.trim() }) : verificationStrategy === "phone_code" ? await signIn.mfa.verifyPhoneCode({ code: code.trim() }) : verificationStrategy === "totp" ? await signIn.mfa.verifyTOTP({ code: code.trim() }) : await signIn.mfa.verifyBackupCode({ code: code.trim() });
      if (error) throw error;
      await continueSignIn(signIn);
    } catch (error) { setFormError(getClerkErrorMessage(error)); } finally { setIsSubmitting(false); }
  };
  const returnToSignIn = () => { resetMessages(); setCode(""); setPassword(""); setConfirmPassword(""); setView("sign-in"); };
  const title = view === "sign-in" ? "Bienvenido de vuelta" : view === "forgot-password" ? "Recuperá tu acceso" : view === "recovery-code" ? "Verificá tu correo" : view === "new-password" ? "Actualizá tu contraseña" : view === "verification" ? "Verificá tu identidad" : "Verificación de seguridad";
  const description = view === "sign-in" ? "Ingresá con tu cuenta Mediasis para administrar tu negocio." : view === "forgot-password" ? "Te enviaremos un código para que puedas crear una contraseña nueva." : view === "recovery-code" ? `Ingresá el código enviado a ${email}.` : view === "new-password" ? "Tu cuenta requiere una contraseña nueva antes de continuar." : view === "verification" ? verificationDestination ? `Ingresá el código enviado a ${verificationDestination}.` : "Ingresá el código de tu autenticador o uno de tus códigos de respaldo." : "Este inicio de sesión requiere una comprobación adicional. Volvé a intentar para continuar.";
  const errorBox = formError ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{formError}</p> : null;
  const primaryClass = "h-12 w-full rounded-xl bg-[#0067ff] text-base font-semibold text-white shadow-sm hover:bg-[#0059dc] focus-visible:ring-[#0067ff]/40";
  return <div className="w-full max-w-[420px] p-6 sm:p-9">
    <div className="mb-8">
      {view !== "sign-in" ? <button type="button" onClick={returnToSignIn} className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-slate-500 outline-none hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#0067ff]"><ArrowLeft className="size-4" aria-hidden="true" /> Volver a iniciar sesión</button> : null}
      <div className="mb-5 flex justify-center text-[#0067ff]">{view === "sign-in" ? <Image src="/images/mediasis-mark.png" alt="Mediasis" width={48} height={48} className="size-12" unoptimized /> : <ShieldCheck className="size-7" aria-hidden="true" />}</div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
    </div>
    {!isLoaded ? <div className="flex min-h-48 items-center justify-center"><LoaderCircle className="size-6 animate-spin text-[#0067ff]" aria-label="Cargando" /></div> : null}
    {isLoaded && view === "sign-in" ? <form className="space-y-5" noValidate onSubmit={submitSignIn}>
      <div className="space-y-2"><label className="text-sm font-medium text-slate-800" htmlFor="email">Correo electrónico</label><div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" disabled={isSubmitting} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} className="h-12 rounded-xl border-slate-200 bg-white pl-11 text-slate-950 shadow-none placeholder:text-slate-400 focus-visible:border-[#0067ff] focus-visible:ring-[#0067ff]/25" placeholder="nombre@negocio.com" /></div>{errors.email ? <p id="email-error" className="text-sm text-red-600">{errors.email}</p> : null}</div>
      <PasswordField id="password" label="Contraseña" value={password} onChange={setPassword} error={errors.password} disabled={isSubmitting} />
      <div className="flex justify-end"><button type="button" onClick={() => { resetMessages(); setView("forgot-password"); }} className="text-sm font-medium text-[#0067ff] outline-none hover:text-[#0059dc] focus-visible:ring-2 focus-visible:ring-[#0067ff] dark:text-[#7fb0ff]">¿Olvidaste tu contraseña?</button></div>
      {errorBox}<Button type="submit" disabled={isSubmitting} className={primaryClass}>{isSubmitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}{isSubmitting ? "Procesando…" : "Iniciar sesión"}</Button>
      <p className="text-center text-sm text-slate-600">¿Todavía no tenés una cuenta? <Link href="/clerk-auth/get-started" className="font-semibold text-[#0067ff] hover:underline">Crear una cuenta</Link></p>
    </form> : null}
    {isLoaded && view === "forgot-password" ? <form className="space-y-5" noValidate onSubmit={submitRecoveryRequest}><div className="space-y-2"><label className="text-sm font-medium text-slate-800" htmlFor="recovery-email">Correo electrónico</label><Input id="recovery-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" disabled={isSubmitting} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "recovery-email-error" : undefined} className="h-12 rounded-xl border-slate-200 bg-white px-4 text-slate-950 shadow-none placeholder:text-slate-400 focus-visible:border-[#0067ff] focus-visible:ring-[#0067ff]/25" placeholder="nombre@negocio.com" />{errors.email ? <p id="recovery-email-error" className="text-sm text-red-600">{errors.email}</p> : null}</div>{errorBox}<Button type="submit" disabled={isSubmitting} className={primaryClass}>{isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}Enviar código</Button></form> : null}
    {isLoaded && view === "recovery-code" ? <form className="space-y-5" noValidate onSubmit={submitRecoveryCode}><div className="space-y-2"><label className="text-sm font-medium text-slate-800" htmlFor="recovery-code">Código de verificación</label><OtpField id="recovery-code" value={code} onChange={setCode} error={errors.code} disabled={isSubmitting} /></div>{errorBox}<Button type="submit" disabled={isSubmitting} className={primaryClass}>{isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}Verificar código</Button></form> : null}
    {isLoaded && view === "new-password" ? <form className="space-y-5" noValidate onSubmit={submitNewPassword}><PasswordField id="new-password" label="Nueva contraseña" value={password} onChange={setPassword} error={errors.password} disabled={isSubmitting} autoComplete="new-password" /><PasswordField id="confirm-password" label="Confirmá la contraseña" value={confirmPassword} onChange={setConfirmPassword} error={errors.confirmPassword} disabled={isSubmitting} autoComplete="new-password" />{errorBox}<Button type="submit" disabled={isSubmitting} className={primaryClass}>{isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}Guardar contraseña</Button></form> : null}
    {isLoaded && view === "verification" ? <form className="space-y-5" noValidate onSubmit={submitVerification}><div className="space-y-2"><label className="text-sm font-medium text-slate-800" htmlFor="verification-code">{verificationStrategy === "backup_code" ? "Código de respaldo" : "Código de verificación"}</label>{verificationStrategy === "backup_code" ? <Input id="verification-code" autoFocus value={code} onChange={(event) => setCode(event.target.value)} disabled={isSubmitting} aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? "verification-code-error" : undefined} className="h-12 rounded-xl border-slate-200 bg-white px-4 text-slate-950 shadow-none focus-visible:border-[#0067ff] focus-visible:ring-[#0067ff]/25" /> : <OtpField id="verification-code" value={code} onChange={setCode} error={errors.code} disabled={isSubmitting} />}{verificationStrategy === "backup_code" && errors.code ? <p id="verification-code-error" className="text-sm text-red-600">{errors.code}</p> : null}</div>{errorBox}<Button type="submit" disabled={isSubmitting} className={primaryClass}>{isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}Verificar</Button></form> : null}
    {isLoaded && view === "protect-check" ? <Button type="button" onClick={returnToSignIn} className={primaryClass}>Intentar de nuevo</Button> : null}
  </div>;
}

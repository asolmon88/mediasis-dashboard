"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { Country } from "react-phone-number-input";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CountryFlag } from "@/components/ui/phone-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SignupCountry, SignupPlan } from "@/lib/dashboard/merchant-onboarding";
import { PLAN_FEATURES } from "@/lib/plan-features";

type Cadence = "monthly" | "annual";
type Catalog = { countries: SignupCountry[]; plans: SignupPlan[] };

type PlanKey = "lite" | "basic" | "uber";

const plans = [
  {
    key: "lite",
    name: "mediasis lite",
    selectable: true,
    description: "Todo lo que necesitás para tener tu propio linkapp. La mejor forma de recibir pedidos por tu propia app, sin fricción y sin que tus clientes tengan que descargar nada.",
  },
  {
    key: "basic",
    name: "mediasis basic",
    selectable: true,
    description: "",
  },
  {
    key: "uber",
    name: "mediasis-Uber",
    selectable: false,
    description: "El ecosistema de Mediasis completo: conectá tu link de pedidos con Uber. Esta es la nueva forma en la que podés vender sin depender de apps de delivery.",
  },
] as const;

const displayUsd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function FeatureList({ planKey, variant }: { planKey: PlanKey; variant: "light" | "dark" }) {
  const isDark = variant === "dark";
  return <ul className="space-y-3">{PLAN_FEATURES.map((feature) => {
    const included = feature.includedIn.includes(planKey);
    return <li key={feature.label} className={`flex gap-2.5 text-sm leading-5 ${included ? "font-medium" : "font-medium line-through opacity-45"} ${isDark ? "text-[#f4f7ff]" : "text-[#081126]"}`}><Check aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${included ? (isDark ? "text-white" : "text-[#0067ff]") : "text-current"}`} strokeWidth={included ? 2.5 : 2} /><span>{feature.label}</span></li>;
  })}</ul>;
}

function UberBenefitTiles() {
  return <div className="grid grid-cols-2 gap-3">
    <div className="rounded-2xl bg-white/95 p-4 text-center text-[#07111f]">
      <Image src="/images/uber.svg" alt="Uber" width={112} height={39} className="mx-auto h-8 w-auto object-contain" />
      <p className="mt-2 text-xs leading-5">Conectá los motorizados de Uber</p>
    </div>
    <div className="rounded-2xl bg-white/95 p-4 text-center text-[#07111f]">
      <div className="flex h-8 items-center justify-center gap-2">
        <Image src="/images/visa.svg" alt="Visa" width={37} height={12} className="h-auto max-h-5 w-auto" />
        <Image src="/images/mastercard.svg" alt="Mastercard" width={27} height={17} className="h-auto max-h-5 w-auto" />
        <Image src="/images/amex.svg" alt="American Express" width={28} height={18} className="h-auto max-h-5 w-auto" />
      </div>
      <p className="mt-2 text-xs font-medium leading-5">Aceptá pagos con tarjeta</p>
    </div>
    <div className="col-span-2 rounded-2xl bg-white/95 px-4 py-4 text-center text-[#07111f]">
      <p className="font-[family-name:var(--font-garet)] text-4xl font-bold leading-none"><span className="text-black">+</span><span className="text-[#ff6767]">200</span></p>
      <p className="mt-1 text-sm">farmacias <strong>afiliados</strong></p>
    </div>
  </div>;
}

function LiteMarketingPanel() {
  return <div className="relative h-80 overflow-hidden px-6 pt-0 text-center sm:h-[22rem] sm:px-8 sm:pt-0">
    <p className="font-[family-name:var(--font-atkinson)] text-sm font-bold uppercase leading-none text-white/65 sm:text-base">Creá tu</p>
    <p className="mt-1 font-[family-name:var(--font-garet)] text-3xl font-bold leading-none tracking-[-0.06em] text-[#ff6767] sm:text-4xl">LINK-APP</p>
    <p className="mx-auto mt-3 max-w-[15rem] text-[11px] leading-4 text-white/70 sm:max-w-xs sm:text-xs">Aceptá pedidos desde tu propia app, sin fricción y sin que tus clientes tengan que descargar nada</p>
    <Image src="/images/phone.png" alt="Ejemplo de una Link-App de Mediasis" width={1024} height={2133} className="absolute bottom-2 left-1/2 h-48 w-auto -translate-x-1/2 object-contain sm:bottom-3 sm:h-56" />
  </div>;
}

function TwoPhonesPanel() {
  return <div className="flex h-80 items-center justify-center overflow-hidden sm:h-[22rem]">
    <Image src="/images/two-phones-transparent.png" alt="Dos ejemplos de apps de pedidos Mediasis" width={1307} height={1962} className="h-full w-full object-contain" />
  </div>;
}

export function MediasisPlanCatalog({ catalog, countryCode, billingCadence, onCountryChange, onCadenceChange, onSelectPlan, busyPlan, eyebrow = "Paso 1 de 2", description = "Podrás configurar tu negocio después de crear tu cuenta.", error, surface = "contained", signInHref }: {
  catalog: Catalog;
  countryCode: string;
  billingCadence: Cadence;
  onCountryChange: (country: string) => void;
  onCadenceChange: (cadence: Cadence) => void;
  onSelectPlan: (plan: "lite" | "basic") => void;
  busyPlan?: "lite" | "basic" | null;
  eyebrow?: string;
  description?: string;
  error?: string | null;
  surface?: "contained" | "standalone";
  signInHref?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendlyOpen, setCalendlyOpen] = useState(false);
  const country = catalog.countries.find((item) => item.countryCode === countryCode);
  const planData = (key: "lite" | "basic") => catalog.plans.find((item) => item.key === key);
  const priceData = (key: "lite" | "basic") => planData(key)?.prices.USD;
  const priceFor = (key: "lite" | "basic") => { const price = priceData(key); return billingCadence === "annual" ? (price?.annualMinor == null ? null : price.annualMinor / 12) : price?.monthlyMinor ?? null; };
  const planPriceLabel = (key: "lite" | "basic") => { const price = priceData(key); return billingCadence === "annual" ? `${displayUsd(price?.annualMinor ?? 0)} facturados anualmente` : "USD · facturado mensualmente"; };

  const isStandalone = surface === "standalone";
  return <><section className={`${isStandalone ? "min-h-svh" : "mt-8 rounded-[32px] shadow-[0_24px_70px_rgba(0,12,39,0.28)] sm:mt-10 sm:rounded-[40px]"} overflow-hidden bg-[#02050c] text-white`}><div className={`relative isolate overflow-hidden ${isStandalone ? "min-h-svh px-5 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16" : "px-5 py-9 sm:px-8 sm:py-12 lg:px-12 lg:py-14"}`}><div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_0%_0%,rgba(194,228,255,0.18),transparent_26%),radial-gradient(circle_at_100%_30%,rgba(0,103,255,0.17),transparent_30%),linear-gradient(135deg,#030711_0%,#02050c_54%,#071627_100%)]" /><div aria-hidden="true" className="absolute -left-24 bottom-0 -z-10 size-72 rounded-full bg-[#0067ff]/10 blur-3xl" />
    <div className="mx-auto max-w-7xl"><div className="grid gap-6 text-center lg:grid-cols-[1fr_auto_1fr] lg:items-start lg:text-left"><div className="order-2 flex justify-center lg:order-1 lg:justify-start"><div role="group" aria-label="Frecuencia de pago" className="inline-grid grid-cols-2 rounded-full border border-white/25 bg-white/10 p-1 backdrop-blur-sm"><button type="button" aria-pressed={billingCadence === "monthly"} onClick={() => onCadenceChange("monthly")} className={`rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#02050c] ${billingCadence === "monthly" ? "bg-white text-[#07111f] shadow-sm" : "text-white/70 hover:text-white"}`}>Mensual</button><button type="button" aria-pressed={billingCadence === "annual"} onClick={() => onCadenceChange("annual")} className={`rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#02050c] ${billingCadence === "annual" ? "bg-white text-[#07111f] shadow-sm" : "text-white/70 hover:text-white"}`}>Anual</button></div></div>
      <div className="order-1 text-center lg:order-2"><img src="/mediasis-logo.png" alt="mediasis" width={438} height={130} className="mx-auto h-auto w-24 sm:w-32" /><p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#c2e4ff]">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Elegí el plan para tu negocio</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/70 lg:text-base">{description}</p></div>
      <div className="order-3 flex flex-col items-center gap-3 lg:items-end">{signInHref ? <a href={signInHref} className="text-sm font-semibold text-[#c2e4ff] transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#02050c]">Ya tengo una cuenta</a> : null}<Popover open={pickerOpen} onOpenChange={setPickerOpen}><PopoverTrigger asChild><Button type="button" variant="outline" className="h-10 gap-2 rounded-full border-white/25 bg-white/10 px-3 text-sm font-medium text-white shadow-none backdrop-blur-sm hover:bg-white/20 hover:text-white">{country ? <CountryFlag country={country.countryCode as Country} countryName={country.name} /> : null}<span className="max-w-36 truncate">{country?.name ?? "País"}</span><ChevronDown className="size-4 text-white/70" /></Button></PopoverTrigger><PopoverContent align="end" className="w-64 p-1.5"><p className="px-2 py-1.5 text-xs font-medium text-slate-500">País de tu negocio</p><div className="space-y-0.5">{catalog.countries.map((item) => <button key={item.countryCode} type="button" onClick={() => { onCountryChange(item.countryCode); setPickerOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067ff]"><CountryFlag country={item.countryCode as Country} countryName={item.name} /><span className="flex-1">{item.name}</span><Check className={`size-4 text-[#0067ff] ${item.countryCode === countryCode ? "opacity-100" : "opacity-0"}`} /></button>)}</div></PopoverContent></Popover></div></div>
      <div className="mt-10 grid gap-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(300px,1.08fr)_minmax(0,0.95fr)] lg:items-stretch">{plans.map((plan) => { const catalogPlan = plan.selectable ? planData(plan.key) : undefined; const monthly = plan.selectable ? priceFor(plan.key) : null; const isBasic = plan.key === "basic"; const isUber = plan.key === "uber";
        if (isUber) return <article key={plan.key} className="flex flex-col px-1 py-2 sm:px-4 lg:px-1"><h2 className="font-[family-name:var(--font-atkinson)] text-3xl font-bold uppercase tracking-tight text-white">Mediasis Uber</h2><p className="mt-3 max-w-sm text-base font-semibold leading-6 text-white">Agenda una reunión con nuestro equipo</p><p className="mt-6 text-sm leading-6 text-white/70">{plan.description}</p><div className="mt-6 flex-1 border-t border-white/20 pt-6"><FeatureList planKey={plan.key} variant="dark" /></div><button type="button" onClick={() => setCalendlyOpen(true)} className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#fff_0%,#eef0ff_45%,#c2e4ff_100%)] px-5 text-center text-sm font-bold text-[#061122] shadow-lg shadow-black/20 transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#02050c]">Agendá una reunión</button></article>;
        return <article key={plan.key} className={`flex flex-col ${isBasic ? "rounded-[30px] bg-[linear-gradient(155deg,#ffffff_0%,#eef0ff_48%,#c2e4ff_100%)] p-6 text-[#07111f] shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-8 lg:-my-5 lg:min-h-[760px]" : "px-1 py-2 sm:px-4 lg:px-1"}`}><div><h2 className={`font-[family-name:var(--font-atkinson)] text-3xl font-bold uppercase tracking-tight ${isBasic ? "text-[#07111f]" : "text-white"}`}>{catalogPlan?.name ?? plan.name}</h2><p className={`mt-1 font-[family-name:var(--font-atkinson)] text-sm ${isBasic ? "text-[#28364f]" : "text-white/75"}`}>Por {billingCadence === "annual" ? "año" : "mes"}</p><p className={`mt-4 font-[family-name:var(--font-garet)] text-6xl font-bold tracking-[-0.08em] ${isBasic ? "text-black" : "text-[#eef0ff]"}`}>{monthly == null ? "—" : displayUsd(monthly)}</p><p className={`mt-2 text-xs font-medium ${isBasic ? "text-[#40516e]" : "text-white/65"}`}>{planPriceLabel(plan.key)}</p><p className={`mt-4 inline-flex rounded-full px-3 py-1 text-xs font-bold ${isBasic ? "bg-[#0067ff]/10 text-[#0058dd]" : "bg-white/10 text-white"}`}>7 días gratis</p></div>{plan.description ? <p className={`mt-7 text-sm leading-6 ${isBasic ? "text-[#40516e]" : "text-white/70"}`}>{plan.description}</p> : null}<div className={`mt-7 flex-1 border-t pt-6 ${isBasic ? "border-slate-900/20" : "border-white/20"}`}><FeatureList planKey={plan.key} variant={isBasic ? "light" : "dark"} /></div><Button disabled={monthly == null || busyPlan != null} onClick={() => onSelectPlan(plan.key)} className={`mt-8 min-h-12 rounded-xl font-bold ${isBasic ? "bg-[#061122] text-white hover:bg-[#162641]" : "bg-[linear-gradient(135deg,#fff_0%,#eef0ff_45%,#c2e4ff_100%)] text-[#061122] hover:brightness-105"}`}>{catalogPlan?.name ?? plan.name} · 7 días gratis<ArrowRight className="size-4" /></Button></article>;
      })}</div>
      <section aria-label="Beneficios incluidos" className="mt-10 grid gap-7 border-t border-white/15 pt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(300px,1.08fr)_minmax(0,0.95fr)] lg:items-start">
        <TwoPhonesPanel />
        <LiteMarketingPanel />
        <UberBenefitTiles />
      </section>
      <div className="mt-8 flex items-end justify-between gap-4 border-t border-white/15 pt-5"><Image src="/images/uber-partner-tech.svg" alt="Uber Partner Tech" width={190} height={42} className="h-auto w-36 object-contain sm:w-44" /><p className="max-w-sm text-right text-xs leading-5 text-white/45">Los precios se muestran según el país y la frecuencia de facturación seleccionados.</p></div>{error ? <p role="alert" className="mt-5 text-center text-sm font-medium text-[#ffb8b8]">{error}</p> : null}
    </div></div></section>
    <Dialog open={calendlyOpen} onOpenChange={setCalendlyOpen}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-0 overflow-hidden border-0 bg-white p-0 sm:max-w-4xl" aria-describedby="calendly-description">
        <DialogHeader className="sr-only">
          <DialogTitle>Agendá una reunión con Mediasis</DialogTitle>
          <DialogDescription id="calendly-description">Elegí el horario que mejor te funcione para conocer Mediasis Uber.</DialogDescription>
        </DialogHeader>
        <iframe
          title="Calendario para agendar una reunión con Mediasis"
          src="https://calendly.com/mediasiscr/mediasis-servicios?hide_gdpr_banner=1"
          className="h-[min(720px,calc(100svh-2rem))] w-full border-0"
        />
      </DialogContent>
    </Dialog>
  </>;
}

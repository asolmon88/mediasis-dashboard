import Image from "next/image";
import type { Viewport } from "next";

import { MediasisSignInForm } from "@/components/auth/mediasis-sign-in-form";
import artwork from "./sign-in-artwork.module.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function DashboardClerkSignInPage() {
  return (
    <main className="min-h-dvh bg-white sm:bg-[#f6f8fc] sm:p-4 lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-4">
      <section className={`${artwork.panel} order-2 hidden min-h-[calc(100dvh-2rem)] rounded-[28px] text-white lg:block`}>
        <div className={artwork.floorLight} aria-hidden="true" />
        <div className={artwork.grain} aria-hidden="true" />
        <div className={artwork.stage}>
          <Image
            src="/images/mediasis-uber-login.png"
            alt="Mediasis con Uber"
            width={472}
            height={270}
            priority
            className={artwork.logo}
          />
          <div className={artwork.phoneShadow} aria-hidden="true" />
          <Image
            src="/images/phone-sign-in.png"
            alt="Una tienda Mediasis mostrada en un teléfono"
            width={1678}
            height={2098}
            priority
            sizes="42vw"
            className={artwork.phone}
          />
          <p className={artwork.caption}>
            Aceptá pedidos desde tu propia app, sin fricción y sin
            <br />
            que tus clientes tengan que descargar nada
          </p>
        </div>
      </section>
      <section className="relative order-1 flex min-h-dvh items-center justify-center bg-white px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] sm:min-h-[calc(100dvh-2rem)] sm:rounded-[28px] sm:px-8 sm:py-10 lg:px-12">
        <div className="absolute left-6 top-[max(1.75rem,env(safe-area-inset-top))] flex items-center gap-2 lg:hidden"><Image src="/images/mediasis-mark.png" alt="Mediasis" width={28} height={28} className="size-7" unoptimized /><span className="text-sm font-medium text-slate-500">Panel de negocios</span></div>
        <MediasisSignInForm />
      </section>
    </main>
  );
}

import Image from "next/image";

import { MediasisSignInForm } from "@/components/auth/mediasis-sign-in-form";

export default function DashboardClerkSignInPage() {
  return (
    <main className="min-h-svh bg-[#f6f8fc] p-3 sm:p-4 lg:grid lg:grid-cols-2 lg:gap-4">
      <section className="relative order-2 hidden min-h-[calc(100svh-2rem)] overflow-hidden rounded-[28px] bg-[#020614] lg:block">
        <Image src="/images/auth/mediasis-sign-in-artwork-dark.png" alt="Mediasis, Uber Partner Tech" fill priority sizes="50vw" className="object-cover object-center" />
      </section>
      <section className="relative order-1 flex min-h-[calc(100svh-1.5rem)] items-center justify-center rounded-[28px] bg-white px-5 py-10 sm:px-8 lg:min-h-[calc(100svh-2rem)] lg:px-12">
        <div className="absolute left-6 top-7 flex items-center gap-2 lg:hidden"><Image src="/images/mediasis-mark.png" alt="Mediasis" width={28} height={28} className="size-7" unoptimized /><span className="text-sm font-medium text-slate-500">Panel de negocios</span></div>
        <MediasisSignInForm />
      </section>
    </main>
  );
}

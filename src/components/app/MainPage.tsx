"use client"

import { usePathname } from "next/navigation"

import { normalizePath } from "@/lib/utils"
import StartCardsForm from "./StartCardsForm"
import Phone from "./Phone"
import TopBar from "./TopBar"
import { JSX } from "react"
import AppearanceForm from "./AppearanceForm"
import CheckoutForm from "./CheckoutForm"
import { StorefrontShareCard } from "./StorefrontShareCard"

type MainPageProps ={
  storefrontUrl?: string | null;
  storefrontKind?: "custom_domain" | "mediasis_link";
}

export default function MainPage({ storefrontUrl = null, storefrontKind }: MainPageProps) {
  const pathname = usePathname()
  const basePath = "/admin/app"
  const pathAfterBase = pathname?.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname
  const normalizedRoute = normalizePath(pathAfterBase || "/start")
  const phoneDomain = (() => {
    const previewDomain = storefrontUrl?.trim()
    if (!previewDomain) return undefined
    if (normalizedRoute !== "/checkout") return storefrontUrl
    try {
      const url = new URL(previewDomain.startsWith("http") ? previewDomain : `https://${previewDomain}`)
      url.pathname = "/checkout"
      return url.toString()
    } catch {
      return previewDomain.endsWith("/checkout") ? previewDomain : `${previewDomain.replace(/\/$/, "")}/checkout`
    }
  })()

  const routeComponents: Record<string, JSX.Element> = {
    "/start": <StartCardsForm />,
    "/checkout": <CheckoutForm />,
    "/appearance": <AppearanceForm />,
  }

  const activeComponent = routeComponents[normalizedRoute] ?? routeComponents["/start"]

  return (
    <div className="px-4 py-2">
      <TopBar pathname={pathname} />
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-1 pt-4 md:flex-row md:items-start md:justify-center md:gap-3">
        <div className="w-full md:max-w-xl">
          {activeComponent}
        </div>
        <div className="w-full md:sticky md:top-20 md:self-start md:shrink-0 md:basis-[312px]">
          <div className="hidden md:block">
            <Phone domain={phoneDomain} />
          </div>
          <StorefrontShareCard url={storefrontUrl} kind={storefrontKind} />
        </div>
      </div>
    </div>
  );
}

"use client";

import { MapPin, Menu, ShoppingBag } from "lucide-react";
import { Geist } from "next/font/google";
import { Button } from "@/components/ui/button";

const storefrontFont = Geist({ subsets: ["latin"] });

// Mirrors the order app's CartActionButton contrast rule. This preview has no
// market provider or real cart, so only its visual content is reproduced here.
function isHexDark(hex: string) {
  if (!hex || !hex.startsWith("#") || (hex.length !== 7 && hex.length !== 4)) return false;
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.8;
}

type Props = {
  businessName: string;
  locationName: string;
  phone: string;
  slug: string;
  primaryColor: string;
  backgroundColor: string;
  logoUrl?: string;
  productName?: string | null;
  productPrice?: string | number | null;
  productDescription?: string | null;
  productImageUrl?: string | null;
  productSkipped?: boolean;
  cashEnabled?: boolean;
  pickupEnabled?: boolean;
  tableEnabled?: boolean;
};

// A visual copy of the order app's TopBar → HeroSection → StartCards layout.
// It receives form state only; no storefront requests or checkout controls run here.
export default function StorefrontVisualPreview({ businessName, locationName, primaryColor, backgroundColor,
  logoUrl, productName, productPrice, productDescription, productImageUrl, productSkipped = false,
  pickupEnabled = false, tableEnabled = false }: Props) {
  const name = businessName.trim() || "Tu negocio";
  const merchantLogo = logoUrl && /^(https?:|blob:|data:image\/)/.test(logoUrl) ? logoUrl : null;
  const hasProduct = Boolean(productName?.trim());
  const amount = productPrice !== null && productPrice !== undefined && String(productPrice).trim()
    && Number.isFinite(Number(productPrice)) ? `₡${Number(productPrice).toLocaleString("es-CR")}` : null;

  return <div className={`${storefrontFont.className} pointer-events-none relative h-[792px] overflow-hidden bg-white text-[#111]`} aria-label="Vista previa visual, no interactiva">
    <header className="relative flex h-[49px] items-center justify-between border-b border-[#e5e5e5] bg-white px-3 text-[#737373] shadow-sm">
      <Menu size={20} strokeWidth={2} aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border border-[#e5e5e5] bg-[#f5f5f5] text-[10px] text-[#737373] shadow-sm">
        {merchantLogo ? <img src={merchantLogo} alt="" className="h-full w-full object-cover" /> : <span>Logo</span>}
      </div>
      <ShoppingBag size={20} strokeWidth={2} aria-hidden="true" />
    </header>

    <main className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-8 px-4 pb-24 pt-6">
      <section className="flex w-full flex-col items-center gap-4">
        <div className="relative w-full">
          <div className="h-52 w-full overflow-hidden rounded-2xl shadow-sm" style={{ backgroundColor }} />
          <div className="absolute left-1/2 top-full flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-[3px] border-white bg-[#f5f5f5] text-sm font-semibold text-[#737373] shadow-lg">
            {merchantLogo ? <img src={merchantLogo} alt="" className="h-full w-full object-cover" /> : <span>Tu logo</span>}
          </div>
        </div>
        <h1 className="mt-14 text-center text-2xl font-medium tracking-tight">{name}</h1>

        {pickupEnabled ? <div className="w-full">
          <div className="flex h-10 w-full items-center justify-start gap-1 overflow-hidden rounded-full bg-[#ececec] p-1">
            <div className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-full border border-white bg-white px-2.5 text-sm font-normal text-[#111] shadow-[0_1px_3px_rgba(0,0,0,0.12)]"><span className="truncate">Pick up</span></div>
            {tableEnabled ? <div className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-full border border-transparent px-2.5 text-sm font-normal text-[#666]"><span className="truncate">En mesa</span></div> : null}
          </div>
        </div> : null}
        {pickupEnabled && locationName.trim() ? <div className="flex w-full items-center justify-center">
          <div className="inline-flex h-auto w-fit flex-wrap items-center justify-center gap-2 rounded-lg p-0">
            <div className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-normal shadow-sm ${isHexDark(primaryColor) ? "text-white" : "text-[#111]"}`}
              style={{ backgroundColor: primaryColor, borderColor: primaryColor }}><MapPin size={16} /><span>{locationName}</span></div>
          </div>
        </div> : null}
      </section>

      {hasProduct ? <section className="flex w-full flex-col gap-6 rounded-3xl border border-[#e5e5e5] bg-white p-4 shadow-[0px_1px_10px_-2px_#e6e6e6]">
        <h2 className="-mb-3 text-base font-semibold text-[#111]">Menú</h2>
        <div className="flex flex-col divide-y">
          <div className="flex w-full gap-3 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-base font-normal text-[#111]">{productName}</p>
              {productDescription ? <p className="line-clamp-2 text-sm font-normal text-[#737373]">{productDescription}</p> : null}
              {amount ? <p className="text-sm font-normal text-[#111]">{amount}</p> : null}
            </div>
            {productImageUrl ? <div className="relative h-[100px] w-[100px] shrink-0 overflow-hidden rounded-lg"><img src={productImageUrl} alt="" className="h-full w-full object-cover" /></div> : null}
          </div>
        </div>
      </section> : productSkipped ? <section className="flex w-full flex-col gap-3 rounded-3xl border border-[#e5e5e5] bg-white px-6 py-6 shadow-[0px_1px_10px_-2px_#e6e6e6]">
        <h2 className="text-center text-base font-medium">Bienvenido a {name}</h2>
        <p className="text-left text-sm font-normal">Pronto vas a poder mostrar tus productos aquí.</p>
      </section> : null}

    </main>
    <footer className="absolute inset-x-0 bottom-24 z-30 text-center text-sm text-[#737373]">
      <p>Creado con:</p>
      <img src="/mediasis-logo.png" alt="Mediasis" className="mx-auto mt-2 h-7 w-auto" />
    </footer>
    <div className="absolute bottom-0 left-0 right-0 z-40 mx-auto w-full max-w-screen-sm px-4 pb-4">
      <Button type="button" tabIndex={-1} aria-label="Vista previa del carrito"
        className={`relative flex w-full items-center justify-center gap-3 rounded-xl px-4 py-6 text-base font-semibold transition hover:opacity-90 ${isHexDark(primaryColor) ? "text-white" : "text-foreground"}`}
        style={{ backgroundColor: primaryColor }}>
        <span className={`mr-auto flex h-5 w-5 items-center justify-center rounded-full text-xs font-normal ${isHexDark(primaryColor) ? "bg-white text-foreground" : "bg-foreground/10 text-foreground"}`}>0</span>
        <span className="text-sm font-normal">Cart</span>
        <span className="ml-auto text-xs font-normal">₡0</span>
      </Button>
    </div>
  </div>;
}

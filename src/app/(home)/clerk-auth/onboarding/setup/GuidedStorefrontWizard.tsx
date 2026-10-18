"use client";

import dynamic from "next/dynamic";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

import Phone from "@/components/app/Phone";
import { HexColorPicker } from "@/components/businesses/HexColorPicker";
import FileUpload from "@/components/file-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GuidedBootstrap } from "@/lib/dashboard/guided-onboarding";
import { completeGuidedReview, saveGuidedFulfillment, saveGuidedIdentity, saveGuidedPayments, saveGuidedProduct } from "./actions";

const MapField = dynamic(() => import("@/components/businesses/CreateBusinessMapField"), {
  ssr: false, loading: () => <div className="h-60 animate-pulse rounded-xl bg-slate-100" />,
});

const steps = ["business_setup", "starter_product", "payment_methods", "fulfillment_methods", "review"] as const;
type Step = typeof steps[number];

function isStep(value: string): value is Step { return steps.some((step) => step === value); }

export function GuidedStorefrontWizard({ initialState, storefrontBaseUrl, editReview }: {
  initialState: GuidedBootstrap; storefrontBaseUrl: string; editReview: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [step, setStep] = useState<Step>(editReview ? "review" : isStep(initialState.step) ? initialState.step : "review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState({
    businessName: state.businessName, locationName: state.locationName, phone: state.phone,
    lat: Number(state.lat), lng: Number(state.lng), slug: state.slug ?? "",
    logoUrl: state.logoUrl?.startsWith("http") ? state.logoUrl : "",
    primaryColor: state.primaryColor ?? "#ff7c1d", backgroundColor: state.backgroundColor ?? "#fff7ed",
  });
  const [product, setProduct] = useState({ name: state.productName ?? "", price: state.productPrice == null ? "" : String(state.productPrice),
    description: state.productDescription ?? "", imageUrl: state.productImages?.[0] ?? "" });
  const [initialLogo] = useState(state.logoUrl?.startsWith("http") ? state.logoUrl : "");
  const [initialProductImage] = useState(state.productImages?.[0] ?? "");
  const [tableEnabled, setTableEnabled] = useState(state.tableEnabled);
  const [uploading, setUploading] = useState(false);
  const businessId = state.businessId;
  const index = steps.indexOf(step);

  async function run(action: () => Promise<{ success: boolean; state?: GuidedBootstrap; message?: string }>, next: Step | "payment_method") {
    setBusy(true); setError(null);
    try {
      const result = await action();
      if (!result.success || !result.state) throw new Error(result.message ?? "No se pudo guardar este paso.");
      setState(result.state);
      if (next === "payment_method") window.location.assign(`/clerk-auth/onboarding/payment?business=${encodeURIComponent(businessId)}`);
      else setStep(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar este paso."); }
    finally { setBusy(false); }
  }

  const back = () => { setError(null); if (index > 0) setStep(steps[index - 1]); };
  const title = {
    business_setup: "Tu negocio y tu app",
    starter_product: "Mostrá tu primer producto",
    payment_methods: "Cómo te van a pagar",
    fulfillment_methods: "Cómo entregarás pedidos",
    review: "¡Tu app está lista para verla!",
  }[step];

  return <div className="mx-auto max-w-6xl">
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-8">
        <div className="mb-7"><p className="text-sm font-semibold text-blue-600">Paso {index + 1} de 6</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">{title}</h1>
          <p className="mt-2 text-sm text-slate-600">Tu enlace público mostrará lo que guardés. Los pedidos se habilitarán cuando empiece tu prueba gratis.</p>
        </div>
        {error ? <div role="alert" className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</div> : null}
        {step === "business_setup" ? <div className="space-y-5">
          <label className="block space-y-1 text-sm font-medium">Nombre del negocio<Input value={identity.businessName} onChange={(event) => setIdentity({ ...identity, businessName: event.target.value })} /></label>
          <label className="block space-y-1 text-sm font-medium">Primera ubicación<Input value={identity.locationName} onChange={(event) => setIdentity({ ...identity, locationName: event.target.value })} /></label>
          <label className="block space-y-1 text-sm font-medium">Teléfono de la ubicación<Input value={identity.phone} onChange={(event) => setIdentity({ ...identity, phone: event.target.value })} /></label>
          <div className="space-y-1 text-sm font-medium">Ubicación exacta<MapField value={{ lat: identity.lat, lng: identity.lng }} onChange={(location) => setIdentity({ ...identity, lat: location.lat, lng: location.lng })} /></div>
          <div className="flex flex-col items-start gap-3"><HexColorPicker label="Color principal" value={identity.primaryColor} onChange={(primaryColor) => setIdentity((previous) => ({ ...previous, primaryColor }))} />
            <HexColorPicker label="Color de fondo" value={identity.backgroundColor} onChange={(backgroundColor) => setIdentity((previous) => ({ ...previous, backgroundColor }))} /></div>
          <div className="space-y-2"><p className="text-sm font-medium">Logo <span className="font-normal text-slate-500">(opcional)</span></p>
            <FileUpload bucketName="business-assets" pathPrefix={businessId} multiple={false} maxSize={10 * 1024 * 1024}
              allowedTypes={["image/jpeg", "image/png", "image/webp"]} showPreview autoUpload
              existingFiles={initialLogo && identity.logoUrl === initialLogo ? [initialLogo] : []}
              onExistingFileRemove={() => setIdentity((previous) => ({ ...previous, logoUrl: "" }))}
              customUpload={async (file) => {
                setUploading(true); setError(null);
                try {
                  const form = new FormData();
                  form.set("businessId", businessId); form.set("kind", "logo"); form.set("file", file);
                  const response = await fetch("/api/onboarding/upload", { method: "POST", body: form });
                  const result = await response.json() as { url?: string; error?: string; message?: string };
                  if (!response.ok || !result.url) throw new Error(result.error ?? result.message ?? "No se pudo subir el logo.");
                  return { path: result.url, publicUrl: result.url };
                } finally { setUploading(false); }
              }}
              onUploadComplete={(_, result) => setIdentity((previous) => ({ ...previous, logoUrl: result.publicUrl }))}
              onUploadError={(_, cause) => setError(cause.message)}
              onFilesChange={(files) => { if (files.length === 0) setIdentity((previous) => ({ ...previous, logoUrl: "" })); }} />
          </div>
          <label className="block space-y-1 text-sm font-medium">Enlace de la tienda<div className="flex items-center rounded-md border px-3"><span className="text-slate-500">mediasis.cr/</span><Input className="border-0 shadow-none" value={identity.slug} onChange={(event) => setIdentity({ ...identity, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></div></label>
          <Button className="w-full" disabled={busy || uploading} onClick={() => void run(() => saveGuidedIdentity(businessId, { ...identity, logoUrl: identity.logoUrl || undefined }), "starter_product")}>Guardar y continuar</Button>
        </div> : null}
        {step === "starter_product" ? <div className="space-y-5">
          <p className="text-sm text-slate-600">Mostrá un producto en una categoría Menú. Podés agregar más desde el panel después.</p>
          <label className="block space-y-1 text-sm font-medium">Nombre del producto<Input value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} placeholder="Café de la casa" /></label>
          <label className="block space-y-1 text-sm font-medium">Precio<Input type="number" min="0.01" step="0.01" value={product.price} onChange={(event) => setProduct({ ...product, price: event.target.value })} /></label>
          <label className="block space-y-1 text-sm font-medium">Descripción <span className="font-normal text-slate-500">(opcional)</span><textarea className="min-h-24 w-full rounded-md border p-3" value={product.description} onChange={(event) => setProduct({ ...product, description: event.target.value })} /></label>
          <div className="space-y-2"><p className="text-sm font-medium">Imagen <span className="font-normal text-slate-500">(opcional)</span></p>
            <FileUpload bucketName="products" pathPrefix={businessId} multiple={false} maxSize={10 * 1024 * 1024}
              allowedTypes={["image/jpeg", "image/png", "image/webp"]} showPreview autoUpload
              existingFiles={initialProductImage && product.imageUrl === initialProductImage ? [initialProductImage] : []}
              onExistingFileRemove={() => setProduct((previous) => ({ ...previous, imageUrl: "" }))}
              customUpload={async (file) => {
                setUploading(true);
                try {
                  const form = new FormData();
                  form.set("businessId", businessId); form.set("kind", "product"); form.set("file", file);
                  const response = await fetch("/api/onboarding/upload", { method: "POST", body: form });
                  const result = await response.json() as { url?: string; error?: string; message?: string };
                  if (!response.ok || !result.url) throw new Error(result.error ?? result.message ?? "No se pudo subir la imagen.");
                  return { path: result.url, publicUrl: result.url };
                } finally { setUploading(false); }
              }}
              onUploadComplete={(_, result) => setProduct((previous) => ({ ...previous, imageUrl: result.publicUrl }))}
              onUploadError={(_, cause) => setError(cause.message)}
              onFilesChange={(files) => { if (files.length === 0) setProduct((previous) => ({ ...previous, imageUrl: "" })); }} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><Button disabled={busy || uploading} onClick={() => void run(() => saveGuidedProduct(businessId, { skip: false, name: product.name, price: Number(product.price), description: product.description, imageUrl: product.imageUrl || undefined }), "payment_methods")}>Agregar producto y continuar <ArrowRight aria-hidden="true" /></Button>
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => saveGuidedProduct(businessId, { skip: true }), "payment_methods")}>Omitir por ahora <ArrowRight aria-hidden="true" /></Button></div>
        </div> : null}
        {step === "payment_methods" ? <div className="space-y-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="font-semibold">✓ Efectivo</p><p className="text-sm text-slate-600">Siempre disponible. Se agrega a tu app sin configurar nada.</p></div>
          <p className="text-sm text-slate-600">Podrás configurar otros métodos de pago desde el panel después de activar tu negocio.</p>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" disabled={busy} onClick={back}>← Volver</Button>
            <Button disabled={busy} onClick={() => void run(() => saveGuidedPayments(businessId, { sinpeEnabled: false, sinpePhone: "", sinpeMerchantConfirmed: false }), "fulfillment_methods")}>Guardar y continuar <ArrowRight aria-hidden="true" /></Button>
          </div>
        </div> : null}
        {step === "fulfillment_methods" ? <div className="space-y-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="font-semibold">✓ Pick up</p><p className="text-sm text-slate-600">Tus clientes podrán retirar su pedido.</p></div>
          <label className="flex items-center gap-3 rounded-xl border p-4"><input type="checkbox" checked={tableEnabled} onChange={(event) => setTableEnabled(event.target.checked)} /><span className="font-medium">Agregar En mesa</span></label>
          <p className="text-sm text-slate-600">Podrás configurar Express y otros detalles más adelante desde el panel.</p>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" disabled={busy} onClick={back}>← Volver</Button>
            <Button disabled={busy} onClick={() => void run(() => saveGuidedFulfillment(businessId, { tableEnabled }), "review")}>Guardar y ver mi app <ArrowRight aria-hidden="true" /></Button>
          </div>
        </div> : null}
        {step === "review" ? <div className="space-y-5">
          <p className="text-slate-700">Creaste la base de tu app de pedidos para <strong>{state.businessName}</strong>. Ya podés compartir su enlace; los pedidos se habilitarán al activar la prueba.</p>
          <div className="grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl border p-4"><strong>Pagos</strong><p>Efectivo{state.sinpeEnabled ? " · SINPE Móvil" : ""}</p></div>
            <div className="rounded-xl border p-4"><strong>Entrega</strong><p>Pick up{state.tableEnabled ? " · En mesa" : ""}</p></div></div>
          <a className="break-all text-sm text-blue-600 underline" href={`${storefrontBaseUrl}/${state.slug}`} target="_blank" rel="noreferrer">{storefrontBaseUrl.replace(/^https?:\/\//, "")}/{state.slug}</a>
          <p className="text-sm text-slate-600">Tu prueba gratis de 7 días empezará cuando agregués y confirmés tu tarjeta.</p>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" disabled={busy} onClick={back}>← Volver</Button>
            <Button disabled={busy} onClick={() => void run(() => completeGuidedReview(businessId), "payment_method")}>Agregar tarjeta <ArrowRight aria-hidden="true" /></Button>
          </div>
        </div> : null}
        {index > 0 && step !== "payment_methods" && step !== "fulfillment_methods" && step !== "review" ? <Button className="mt-6" variant="ghost" disabled={busy} onClick={back}>← Volver</Button> : null}
      </section>
      <aside className="flex flex-col items-center gap-3 lg:items-start"><Phone
        title="Vista previa visual de tu app" livePreview={{
          businessName: identity.businessName, locationName: identity.locationName, phone: identity.phone,
          slug: identity.slug, primaryColor: identity.primaryColor, backgroundColor: identity.backgroundColor,
          logoUrl: identity.logoUrl,
          productName: state.productSkippedAt && step !== "starter_product" ? null : product.name || state.productName,
          productPrice: product.price || state.productPrice,
          productDescription: product.description || state.productDescription,
          productImageUrl: product.imageUrl || state.productImages?.[0],
          productSkipped: Boolean(state.productSkippedAt) && (step !== "starter_product" || !product.name.trim()),
          cashEnabled: Boolean(state.paymentsReviewedAt), pickupEnabled: Boolean(state.fulfillmentReviewedAt), tableEnabled,
        }} /><p className="max-w-xs text-center text-xs text-slate-500 lg:text-left">Los cambios sin guardar solo aparecen aquí. <a className="text-blue-600 underline" href={`${storefrontBaseUrl}/${state.slug}`} target="_blank" rel="noreferrer">Abrir la app real</a></p></aside>
    </div>
  </div>;
}

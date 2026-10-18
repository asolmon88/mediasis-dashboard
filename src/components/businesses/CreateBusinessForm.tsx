"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useOrganizationList } from "@clerk/nextjs";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createDashboardBusiness } from "@/app/admin/businesses/new/actions";
import { createOnboardingBusiness } from "@/app/(home)/clerk-auth/onboarding/actions";
import { saveGuidedIdentity } from "@/app/(home)/clerk-auth/onboarding/setup/actions";
import Phone from "@/components/app/Phone";
import { HexColorPicker } from "@/components/businesses/HexColorPicker";
import FileUpload from "@/components/file-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BusinessCreationSchema, type BusinessCreationInput } from "@/lib/FormSchemas/businessCreationSchema";
import type { GuidedIdentity } from "@/lib/dashboard/guided-onboarding";
import { resetPersistedLocation, useLocationStore } from "@/stores/location-store";

// Google Maps extends browser-native classes while its module is evaluated.
// Keeping the provider and map behind an SSR-disabled boundary prevents the
// server bundle from evaluating those classes during the business form render.
const CreateBusinessMapField = dynamic(
  () => import("@/components/businesses/CreateBusinessMapField"),
  {
    ssr: false,
    loading: () => <div className="h-60 w-full animate-pulse rounded-md bg-muted" />,
  },
);

// The phone library's root entry includes a React class that is not safe to
// evaluate in this route's Turbopack SSR bundle. Keep the interactive country
// selector entirely on the client, just like the Google Maps subtree.
const CreateBusinessPhoneField = dynamic(
  () => import("@/components/businesses/CreateBusinessPhoneField"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-9 w-full overflow-hidden rounded-md border bg-background">
        <div className="w-14 border-r bg-muted/40" />
        <div className="flex-1" />
      </div>
    ),
  },
);

export type MarketCountryProfile = {
  countryCode: string;
  countryName: string;
  timezone: string;
  currencyCode: string;
  locale: string;
  phoneCountryCode: string;
  mapCenterLat: number;
  mapCenterLng: number;
  mapDefaultZoom: number;
};

function suggestedSlug(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55);
}

export function CreateBusinessForm({ countryProfiles, onboarding = false, trialEligible = true, initialValues, lockCountry = false, guided = true }: {
  countryProfiles: MarketCountryProfile[];
  onboarding?: boolean;
  trialEligible?: boolean;
  initialValues?: Partial<BusinessCreationInput>;
  lockCountry?: boolean;
  guided?: boolean;
}) {
  const router = useRouter();
  const { setActive, isLoaded } = useOrganizationList();
  const resetLocations = useLocationStore((state) => state.reset);
  const [submitting, setSubmitting] = useState(false);
  const [slug, setSlug] = useState(suggestedSlug(initialValues?.full_name ?? ""));
  const [slugEdited, setSlugEdited] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#ff7c1d");
  const [backgroundColor, setBackgroundColor] = useState("#fff7ed");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const initialProfile = countryProfiles.find((profile) => profile.countryCode === "CR") ?? countryProfiles[0];
  const form = useForm<BusinessCreationInput>({
    resolver: zodResolver(BusinessCreationSchema),
    defaultValues: {
      full_name: initialValues?.full_name ?? "",
      short_name: initialValues?.short_name ?? "",
      phone: initialValues?.phone ?? "",
      location: initialValues?.location ?? { lat: initialProfile?.mapCenterLat ?? 9.932, lng: initialProfile?.mapCenterLng ?? -84.08 },
      countryCode: initialProfile?.countryCode ?? "CR",
      idempotencyKey: initialValues?.idempotencyKey ?? "00000000-0000-4000-8000-000000000000",
    },
  });
  const selectedCountryCode = form.watch("countryCode");
  const businessName = form.watch("full_name");
  const selectedProfile = countryProfiles.find((profile) => profile.countryCode === selectedCountryCode) ?? initialProfile;

  useEffect(() => {
    if (!onboarding && !initialValues?.idempotencyKey) form.setValue("idempotencyKey", crypto.randomUUID());
  }, [form, onboarding, initialValues?.idempotencyKey]);

  useEffect(() => {
    if (!slugEdited) setSlug(suggestedSlug(businessName));
  }, [businessName, slugEdited]);

  const submit = async (values: BusinessCreationInput) => {
    setSubmitting(true);
    try {
      const identity: GuidedIdentity | undefined = guided ? {
        businessName: values.full_name, locationName: values.short_name, phone: values.phone,
        lat: values.location.lat, lng: values.location.lng, slug, primaryColor, backgroundColor,
      } : undefined;
      const result = await (onboarding ? createOnboardingBusiness(values, identity) : createDashboardBusiness(values, identity));
      if (!result.success || !result.organizationId) throw new Error(result.message ?? "No se pudo crear el negocio.");
      if (guided && identity && logoFile) {
        try {
          const uploadData = new FormData();
          uploadData.set("businessId", result.businessId);
          uploadData.set("kind", "logo");
          uploadData.set("file", logoFile);
          const uploadResponse = await fetch("/api/onboarding/upload", { method: "POST", body: uploadData });
          const uploaded = await uploadResponse.json() as { url?: string; error?: string };
          if (!uploadResponse.ok || !uploaded.url) throw new Error(uploaded.error ?? "No se pudo subir el logo.");
          const saved = await saveGuidedIdentity(result.businessId, { ...identity, logoUrl: uploaded.url });
          if (!saved.success) throw new Error(saved.message ?? "No se pudo guardar el logo.");
        } catch (logoError) {
          toast.error(logoError instanceof Error ? `${logoError.message} Podés agregarlo en el siguiente paso.` : "No se pudo guardar el logo. Podés agregarlo en el siguiente paso.");
        }
      }
      if (!isLoaded) throw new Error("Clerk todavía está cargando. Intentá de nuevo.");
      await setActive({ organization: result.organizationId });
      resetLocations();
      resetPersistedLocation();
      toast.success("Negocio creado");
      if (result.paymentRequired) {
        // A full navigation waits for Clerk's newly active organization cookie
        // before the payment step renders.
        window.location.replace(`/clerk-auth/onboarding/setup?business=${encodeURIComponent(result.businessId)}`);
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el negocio.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={guided ? "mx-auto grid w-full max-w-7xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]" : "mx-auto w-full max-w-2xl"}>
    <Card className="min-w-0 border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>{guided ? "Dale vida a tu negocio" : onboarding ? "Creá tu negocio" : "Crear negocio"}</CardTitle>
        <CardDescription>{guided ? "Elegí cómo se verá tu app. Podrás editar todo después." : "Creá el negocio y su primera ubicación. Quedarás asignado como administrador."}{onboarding && trialEligible ? " Tu prueba de 7 días empezará cuando terminemos la configuración." : ""}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(submit)}>
            {!onboarding && !lockCountry ? <FormField control={form.control} name="countryCode" render={({ field }) => (
              <FormItem>
                <FormLabel>País</FormLabel>
                <Select value={field.value} onValueChange={(countryCode) => {
                  field.onChange(countryCode);
                  const profile = countryProfiles.find((item) => item.countryCode === countryCode);
                  if (profile) {
                    form.setValue("location", { lat: profile.mapCenterLat, lng: profile.mapCenterLng });
                    form.setValue("phone", "");
                  }
                }}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Seleccioná un país" /></SelectTrigger></FormControl>
                  <SelectContent>{countryProfiles.map((profile) => (
                    <SelectItem key={profile.countryCode} value={profile.countryCode}>{profile.countryName}</SelectItem>
                  ))}</SelectContent>
                </Select>
                <FormDescription>
                  {selectedProfile ? `${selectedProfile.timezone} · ${selectedProfile.currencyCode} · ${selectedProfile.locale}` : ""}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )} /> : null}
            <div className="grid items-start gap-4 sm:grid-cols-2"><FormField control={form.control} name="full_name" render={({ field }) => (
              <FormItem><FormLabel>Nombre del negocio</FormLabel><FormControl><Input placeholder="Padfy" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="short_name" render={({ field }) => (
              <FormItem><FormLabel>Nombre corto de la ubicación</FormLabel><FormControl><Input placeholder="Los Yoses" {...field} /></FormControl><FormMessage /></FormItem>
            )} /></div>
            <p className="text-sm text-muted-foreground">Podrás agregar más ubicaciones después desde el dashboard.</p>
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Teléfono de la ubicación</FormLabel>
                <FormControl>
                  <CreateBusinessPhoneField
                    name={field.name}
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    defaultCountry={(selectedProfile?.phoneCountryCode ?? "CR") as never}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem>
                <FormLabel>Ubicación exacta</FormLabel>
                <FormControl>
                  <CreateBusinessMapField
                    value={field.value}
                    onChange={field.onChange}
                    defaultZoom={selectedProfile?.mapDefaultZoom}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {guided ? <div className="space-y-4">
              <div className="flex flex-col items-start gap-3">
                <HexColorPicker label="Color principal" value={primaryColor} onChange={setPrimaryColor} />
                <HexColorPicker label="Color de fondo" value={backgroundColor} onChange={setBackgroundColor} />
              </div>
              <div className="space-y-2"><p className="text-sm font-medium">Logo <span className="font-normal text-muted-foreground">(opcional)</span></p>
                <FileUpload bucketName="business-assets" multiple={false} maxSize={5 * 1024 * 1024}
                  allowedTypes={["image/jpeg", "image/png", "image/webp"]} showPreview autoUpload
                  customUpload={async (file) => {
                    const previewUrl = URL.createObjectURL(file);
                    setLogoFile(file);
                    setLogoPreviewUrl((current) => { if (current.startsWith("blob:")) URL.revokeObjectURL(current); return previewUrl; });
                    return { path: file.name, publicUrl: previewUrl };
                  }}
                  onUploadComplete={(_, result) => setLogoPreviewUrl(result.publicUrl)}
                  onUploadError={(_, error) => toast.error(error.message)}
                  onFilesChange={(files) => {
                    if (files.length) { setLogoFile(files[0].file); return; }
                    setLogoFile(null);
                    setLogoPreviewUrl((current) => { if (current.startsWith("blob:")) URL.revokeObjectURL(current); return ""; });
                  }} />
                <p className="text-xs text-muted-foreground">Se subirá cuando creés el negocio.</p>
              </div>
              <label className="block space-y-1 text-sm font-medium">Enlace de la tienda
                <div className="flex items-center rounded-md border bg-background px-3"><span className="shrink-0 text-muted-foreground">mediasis.cr/</span><Input className="border-0 shadow-none focus-visible:ring-0" value={slug} onChange={(event) => {
                  setSlugEdited(true); setSlug(suggestedSlug(event.target.value));
                }} required minLength={3} maxLength={63} /></div>
              </label>
            </div> : null}
            <Button className="w-full" type="submit" disabled={submitting}>{submitting ? "Creando negocio..." : "Crear negocio"}</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
    {guided ? <aside className="rounded-3xl border border-blue-100 bg-[#e9f0ff] px-4 py-6 shadow-sm lg:sticky lg:top-6">
      <div className="flex justify-center"><Phone title="Vista previa de la app de pedidos"
        livePreview={{ businessName, locationName: form.watch("short_name"), phone: form.watch("phone"),
          slug, primaryColor, backgroundColor, logoUrl: logoPreviewUrl }} /></div>
    </aside> : null}
    </div>
  );
}

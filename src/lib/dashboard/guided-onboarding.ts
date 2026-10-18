import "server-only";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { synchronizeClerkIdentity } from "@/lib/dashboard/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const guidedImageUrlSchema = z.string().url().max(2048).refine((value) => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return Boolean(base && value.startsWith(`${base}/storage/v1/object/public/`));
}, "La imagen debe haberse subido desde Mediasis.");

export const guidedIdentitySchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  locationName: z.string().trim().min(2).max(60),
  phone: z.string().trim().min(8).max(24),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(63),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoUrl: guidedImageUrlSchema.optional(),
});

export type GuidedIdentity = z.infer<typeof guidedIdentitySchema>;

export type GuidedBootstrap = {
  businessId: string;
  step: "business_setup" | "starter_product" | "payment_methods" | "fulfillment_methods" | "review" | "payment_method" | "completed";
  identityReviewedAt: string | null;
  productReviewedAt: string | null;
  productSkippedAt: string | null;
  paymentsReviewedAt: string | null;
  fulfillmentReviewedAt: string | null;
  reviewCompletedAt: string | null;
  businessName: string;
  locationId: string;
  locationName: string;
  phone: string;
  lat: number;
  lng: number;
  slug: string;
  displayName: string;
  logoUrl: string;
  primaryColor: string;
  backgroundColor: string;
  productName: string | null;
  productPrice: number | null;
  productDescription: string | null;
  productImages: string[] | null;
  sinpeEnabled: boolean;
  sinpePhone: string | null;
  tableEnabled: boolean;
  plan: string;
  amountMinor: number;
  currencyCode: string;
  billingCadence: string;
};

export async function requireGuidedOwner(businessId: string) {
  const session = await auth();
  if (!session.userId) throw new Error("Iniciá sesión para continuar.");
  await synchronizeClerkIdentity(session.userId);
  const admin = createAdminClient();
  const { data: user, error: userError } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id,status,deleted_at,dashboard_disabled_at")
    .eq("clerk_user_id", session.userId).maybeSingle();
  if (userError || !user?.app_user_id || user.status !== "active" || user.deleted_at || user.dashboard_disabled_at) {
    throw new Error("No se pudo verificar tu cuenta.");
  }
  const { data: owner, error: ownerError } = await admin.schema("mediasis").from("business_account_owners")
    .select("owner_app_user_id").eq("business_id", businessId).maybeSingle();
  if (ownerError || owner?.owner_app_user_id !== user.app_user_id) throw new Error("Solo el propietario puede configurar este negocio.");
  const { data: business, error: businessError } = await admin.schema("mediasis").from("businesses")
    .select("uid,app_active").eq("uid", businessId).maybeSingle();
  if (businessError || !business || business.app_active) throw new Error("Este negocio ya terminó su configuración.");
  return { admin, appUserId: user.app_user_id as string };
}

export async function loadGuidedOnboarding(businessId: string): Promise<GuidedBootstrap> {
  const { admin, appUserId } = await requireGuidedOwner(businessId);
  const { data, error } = await admin.schema("mediasis").rpc("guided_onboarding_bootstrap", {
    p_owner_app_user_id: appUserId, p_business_id: businessId,
  });
  if (error || !data) throw new Error(error?.message ?? "No se pudo recuperar la configuración.");
  return data as GuidedBootstrap;
}

export async function saveGuidedStepForOwner(businessId: string, step: string, payload: Record<string, unknown>) {
  const { admin, appUserId } = await requireGuidedOwner(businessId);
  const { data, error } = await admin.schema("mediasis").rpc("save_guided_onboarding_step", {
    p_owner_app_user_id: appUserId, p_business_id: businessId, p_step: step, p_payload: payload,
  });
  if (error || !data) throw new Error(error?.message ?? "No se pudo guardar este paso.");
  return data as GuidedBootstrap;
}

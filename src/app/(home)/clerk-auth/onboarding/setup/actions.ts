"use server";

import { z } from "zod";

import { guidedIdentitySchema, guidedImageUrlSchema, saveGuidedStepForOwner } from "@/lib/dashboard/guided-onboarding";

const id = z.uuid();

export async function saveGuidedIdentity(businessId: string, input: unknown) {
  try {
    const data = guidedIdentitySchema.parse(input);
    return { success: true as const, state: await saveGuidedStepForOwner(id.parse(businessId), "business_setup", data) };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "Revisá los datos del negocio." };
  }
}

export async function saveGuidedProduct(businessId: string, input: unknown) {
  try {
    const data = z.discriminatedUnion("skip", [
      z.object({ skip: z.literal(true) }),
      z.object({ skip: z.literal(false), name: z.string().trim().min(2).max(160),
        price: z.number().positive().max(100000000), description: z.string().max(2000).default(""),
        imageUrl: guidedImageUrlSchema.optional() }),
    ]).parse(input);
    return { success: true as const, state: await saveGuidedStepForOwner(id.parse(businessId), "starter_product", data) };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "Revisá el producto." };
  }
}

export async function saveGuidedPayments(businessId: string, input: unknown) {
  try {
    const data = z.object({ sinpeEnabled: z.boolean(), sinpePhone: z.string().trim().max(24).optional(),
      sinpeMerchantConfirmed: z.boolean() }).parse(input);
    return { success: true as const, state: await saveGuidedStepForOwner(id.parse(businessId), "payment_methods", data) };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "Revisá los métodos de pago." };
  }
}

export async function saveGuidedFulfillment(businessId: string, input: unknown) {
  try {
    const data = z.object({ tableEnabled: z.boolean() }).parse(input);
    return { success: true as const, state: await saveGuidedStepForOwner(id.parse(businessId), "fulfillment_methods", data) };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "Revisá los métodos de entrega." };
  }
}

export async function completeGuidedReview(businessId: string) {
  try {
    return { success: true as const, state: await saveGuidedStepForOwner(id.parse(businessId), "review", {}) };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo continuar." };
  }
}

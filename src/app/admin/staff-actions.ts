"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

export async function selectStaffBusiness(businessId: string) {
  const session = await auth();
  if (!session.userId) throw new Error("Iniciá sesión nuevamente.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
    throw new Error("Negocio inválido.");
  }

  const admin = createAdminClient();
  const { data: identity } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id").eq("clerk_user_id", session.userId)
    .eq("status", "active").is("deleted_at", null).maybeSingle();
  if (!identity?.app_user_id) throw new Error("No se pudo validar tu identidad.");
  const { data: staff } = await admin.schema("mediasis").rpc("is_mediasis_staff_actor", {
    p_app_user_id: identity.app_user_id,
  });
  if (staff !== true) throw new Error("No tenés acceso de Mediasis a todos los negocios.");

  const { data: business } = await admin.schema("mediasis").from("businesses")
    .select("uid").eq("uid", businessId).eq("active", true).maybeSingle();
  if (!business) throw new Error("El negocio no está disponible.");

  const cookieStore = await cookies();
  cookieStore.set("mediasis_staff_business_id", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0,
  });
  cookieStore.set("mediasis_staff_business_id", businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

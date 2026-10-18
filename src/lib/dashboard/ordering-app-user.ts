import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

const ORDERING_APP_DOMAIN = "mediasis.cr";
const ORDERING_APP_INITIAL_PASSWORD = "E12345678";

export type OrderingAppUser = {
  id: string;
  email: string;
  created: boolean;
};

function compactBusinessName(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized || "negocio";
}

function candidateEmail(localPart: string, businessId: string, useSuffix: boolean) {
  const suffix = useSuffix ? `-${businessId.replace(/-/g, "").slice(0, 8)}` : "";
  // Leave room for `-app` and an optional deterministic collision suffix.
  const maxBaseLength = 64 - "-app".length - suffix.length;
  return `${localPart.slice(0, maxBaseLength)}${suffix}-app@${ORDERING_APP_DOMAIN}`;
}

export function orderingAppEmailForBusinessName(businessName: string, businessId: string) {
  return candidateEmail(compactBusinessName(businessName), businessId, false);
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string) {
  let page = 1;
  const normalizedEmail = email.toLowerCase();
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`No se pudo validar el correo de la App de pedidos: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);
    if (match) return match;
    if (!data.nextPage) return null;
    page = data.nextPage;
  }
}

function isOrderingAppUserForBusiness(user: User, businessId: string) {
  // The historical native-app account predates the explicit metadata marker.
  // Its stable and authoritative identity is the business UUID itself.
  const markedBusinessId = user.app_metadata?.mediasis_legacy_business_id;
  return user.id === businessId
    && (markedBusinessId === businessId || typeof markedBusinessId !== "string");
}

/**
 * Creates the business-wide Supabase account used by the legacy native ordering
 * application. This account deliberately has no Clerk identity or RBAC row.
 */
export async function ensureOrderingAppUser({
  admin,
  businessId,
  businessName,
}: {
  admin: SupabaseClient;
  businessId: string;
  businessName: string;
}): Promise<OrderingAppUser> {
  const { data: existingById, error: byIdError } = await admin.auth.admin.getUserById(businessId);
  if (byIdError && byIdError.status !== 404) {
    throw new Error(`No se pudo validar el usuario de la App de pedidos: ${byIdError.message}`);
  }
  if (existingById.user) {
    if (!isOrderingAppUserForBusiness(existingById.user, businessId) || !existingById.user.email) {
      throw new Error("La identidad de Supabase de este negocio pertenece a otro tipo de cuenta.");
    }
    return { id: existingById.user.id, email: existingById.user.email, created: false };
  }

  const base = compactBusinessName(businessName);
  let email = candidateEmail(base, businessId, false);
  let existingByEmail = await findAuthUserByEmail(admin, email);
  if (existingByEmail) {
    email = candidateEmail(base, businessId, true);
    existingByEmail = await findAuthUserByEmail(admin, email);
  }
  if (existingByEmail) {
    throw new Error("Ya existe otra cuenta de Supabase con el correo de la App de pedidos.");
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    id: businessId,
    email,
    password: ORDERING_APP_INITIAL_PASSWORD,
    email_confirm: true,
    app_metadata: {
      mediasis_legacy_business_id: businessId,
      mediasis_legacy_supervisor: true,
      mediasis_ordering_app_operator: true,
    },
  });
  if (createError || !created.user) {
    throw new Error(createError?.message ?? "No se pudo crear el usuario de la App de pedidos.");
  }
  return { id: created.user.id, email, created: true };
}

export function isOrderingAppOperator(user: User | null | undefined, businessId: string) {
  return Boolean(user && user.id === businessId && isOrderingAppUserForBusiness(user, businessId));
}

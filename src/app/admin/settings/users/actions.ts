"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  BusinessRoleSchema,
  InvitationIdSchema,
  InviteBusinessUserSchema,
  MemberStatusSchema,
  ReservedBusinessUserSchema,
  RoleIdSchema,
  UpdateBusinessMemberSchema,
  type BusinessRoleInput,
  type InviteBusinessUserInput,
  type MemberStatusInput,
  type ReservedBusinessUserInput,
  type UpdateBusinessMemberInput,
} from "@/lib/FormSchemas/teamSchema";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { ensureOrderingAppUser, isOrderingAppOperator } from "@/lib/dashboard/ordering-app-user";
import type { TeamActionResult, TeamManagementData } from "@/lib/dashboard/team-types";
import { reconcileAcceptedBusinessInvitation } from "@/lib/dashboard/reconcile-business-invitation";
import { createAdminClient } from "@/lib/supabase/admin";

type RpcResult = Record<string, unknown> & { success?: boolean; message?: string };

async function requireTeamContext(permission: string) {
  const session = await auth();
  const context = await getDashboardAuthorizationContext();
  if (!session.userId || !context || context.mode === "legacy") {
    throw new Error("Iniciá sesión con Clerk para administrar usuarios.");
  }
  if (!context.activeBusinessId || !context.activeClerkOrganizationId || !context.appUserId) {
    throw new Error("Seleccioná un negocio configurado con Clerk.");
  }
  if (!context.permissions.includes(permission) && !context.permissions.includes("*")) {
    throw new Error("No tenés permiso para realizar esta operación.");
  }
  return {
    clerkUserId: session.userId,
    mode: context.mode,
    businessId: context.activeBusinessId,
    organizationId: context.activeClerkOrganizationId,
    actorAppUserId: context.appUserId,
  };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const admin = createAdminClient();
  const { data, error } = await admin.schema("mediasis").rpc(name, args);
  const result = data as RpcResult | null;
  if (error || !result?.success) throw new Error(error?.message ?? result?.message ?? "La operación no pudo completarse.");
  return result;
}

async function invitationRedirectUrl() {
  const configured = process.env.DASHBOARD_BASE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("DASHBOARD_BASE_URL debe usar HTTPS.");
    return new URL("/clerk-auth/sign-up?redirect_url=/admin/settings/users", url).toString();
  }

  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "").split(",")[0].trim();
  const hostname = host.split(":")[0].toLowerCase();
  const allowed = hostname === "localhost"
    || hostname.endsWith(".mediasis.cr")
    || hostname.endsWith(".mediasis.cr")
    || hostname.endsWith(".vercel.app");
  if (!allowed) throw new Error("No se pudo validar el dominio de invitación.");
  const protocol = hostname === "localhost" ? "http" : "https";
  return `${protocol}://${host}/clerk-auth/sign-up?redirect_url=/admin/settings/users`;
}

function safeError(error: unknown): TeamActionResult {
  const candidate = error as { errors?: Array<{ longMessage?: string; message?: string }>; message?: string };
  const clerkMessage = candidate.errors?.[0]?.longMessage ?? candidate.errors?.[0]?.message;
  const message = clerkMessage ?? candidate.message ?? "La operación no pudo completarse.";
  if (message.includes("authorization_audit_log_pkey")) {
    return {
      success: false,
      message: "No se pudo registrar el cambio de acceso. Aplicá la migración pendiente de auditoría e intentá nuevamente.",
    };
  }
  return { success: false, message };
}

export async function getBusinessTeamData(): Promise<TeamManagementData> {
  const context = await requireTeamContext("members.read");
  const team = await rpc("get_business_team_management", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as TeamManagementData;
  const orders = await rpc("get_business_orders_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const products = await rpc("get_business_products_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const storefront = await rpc("get_business_ordering_app_storefront_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const delivery = await rpc("get_business_ordering_app_delivery_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const schedules = await rpc("get_business_ordering_app_schedules_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const paymentsCashback = await rpc("get_business_ordering_app_payments_cashback_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const automaticStatuses = await rpc("get_business_dashboard_automatic_statuses_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const reservations = await rpc("get_business_reservations_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const developer = await rpc("get_business_developer_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const market = await rpc("get_business_market_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const marketing = await rpc("get_business_marketing_permission_catalog", {
    p_business_id: context.businessId,
    p_actor_app_user_id: context.actorAppUserId,
  }) as unknown as {
    permissions: TeamManagementData["permissions"];
    role_permissions: Record<string, string[]>;
  };
  const supplementalPermissions = [...orders.permissions, ...products.permissions, ...storefront.permissions, ...delivery.permissions, ...schedules.permissions, ...paymentsCashback.permissions, ...automaticStatuses.permissions, ...reservations.permissions, ...developer.permissions, ...market.permissions, ...marketing.permissions];
  const admin = createAdminClient();
  const { data: authUserResult, error: authUserError } = await admin.auth.admin.getUserById(context.businessId);
  if (authUserError && authUserError.status !== 404) {
    throw new Error(`No se pudo cargar el usuario de la App de pedidos: ${authUserError.message}`);
  }
  const orderingAppMember = isOrderingAppOperator(authUserResult.user, context.businessId)
    ? [{
        account_kind: "ordering_app" as const,
        membership_id: `ordering_app:${context.businessId}`,
        app_user_id: context.businessId,
        name: "App de pedidos",
        email: authUserResult.user?.email ?? null,
        avatar_url: null,
        status: "active" as const,
        all_locations: true,
        clerk_membership_id: null,
        role_id: "ordering_app",
        role_key: "ordering_app",
        role_name: "App de pedidos",
        location_ids: [],
        created_at: authUserResult.user?.created_at ?? new Date(0).toISOString(),
      }]
    : [];
  return {
    ...team,
    members: [
      ...team.members.map((member) => ({ ...member, account_kind: "business_member" as const })),
      ...orderingAppMember,
    ].sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
    permissions: [...team.permissions, ...supplementalPermissions.filter(
      (permission) => !team.permissions.some((existing) => existing.key === permission.key),
    )],
    roles: team.roles.map((role) => ({
      ...role,
      permission_keys: Array.from(new Set([
        ...role.permission_keys,
        ...(orders.role_permissions[role.role_id] ?? []),
        ...(products.role_permissions[role.role_id] ?? []),
        ...(storefront.role_permissions[role.role_id] ?? []),
        ...(delivery.role_permissions[role.role_id] ?? []),
        ...(schedules.role_permissions[role.role_id] ?? []),
        ...(paymentsCashback.role_permissions[role.role_id] ?? []),
        ...(automaticStatuses.role_permissions[role.role_id] ?? []),
        ...(reservations.role_permissions[role.role_id] ?? []),
        ...(developer.role_permissions[role.role_id] ?? []),
        ...(market.role_permissions[role.role_id] ?? []),
        ...(marketing.role_permissions[role.role_id] ?? []),
      ])),
    })),
  };
}

export async function inviteBusinessUser(input: InviteBusinessUserInput): Promise<TeamActionResult> {
  const parsed = InviteBusinessUserSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Revisá el correo, rol y ubicaciones." };
  let preparedContext: Awaited<ReturnType<typeof requireTeamContext>> | null = null;
  try {
    const context = await requireTeamContext("members.invite");
    preparedContext = context;
    await rpc("prepare_business_member_provisioning", {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_email: parsed.data.email,
      p_display_name: null,
      p_mode: "invitation",
      p_business_role_id: parsed.data.roleId,
      p_all_locations: parsed.data.allLocations,
      p_location_ids: parsed.data.locationIds,
      p_correlation_id: parsed.data.correlationId,
    });

    const clerk = await clerkClient();
    const reconciliation = await reconcileAcceptedBusinessInvitation({
      businessId: context.businessId,
      organizationId: context.organizationId,
      email: parsed.data.email,
      correlationId: parsed.data.correlationId,
    });
    if (reconciliation.reconciled) {
      revalidatePath("/admin/settings/users");
      return {
        success: true,
        message: "La cuenta ya había aceptado una invitación. Se restauró su acceso al negocio.",
      };
    }
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: context.organizationId,
      emailAddress: parsed.data.email,
      role: "org:member",
      // Mediasis staff intentionally are not members of every pharmacy
      // Organization, so their server-issued invitations omit a visible
      // Organization-member inviter.
      ...(context.mode === "clerk" ? { inviterUserId: context.clerkUserId } : {}),
      expiresInDays: 30,
      redirectUrl: await invitationRedirectUrl(),
      privateMetadata: { mediasisInvitationId: parsed.data.correlationId },
    });
    await rpc("record_business_member_external_ids", {
      p_business_id: context.businessId,
      p_correlation_id: parsed.data.correlationId,
      p_clerk_invitation_id: invitation.id,
      p_clerk_user_id: null,
      p_clerk_membership_id: null,
      p_error: null,
    });
    revalidatePath("/admin/settings/users");
    return { success: true };
  } catch (error) {
    if (preparedContext) {
      await rpc("record_business_member_external_ids", {
        p_business_id: preparedContext.businessId,
        p_correlation_id: parsed.data.correlationId,
        p_clerk_invitation_id: null,
        p_clerk_user_id: null,
        p_clerk_membership_id: null,
        p_error: error instanceof Error ? error.message : "Invitation provisioning failed",
      }).catch(() => undefined);
    }
    return safeError(error);
  }
}

export async function createReservedBusinessUser(input: ReservedBusinessUserInput): Promise<TeamActionResult> {
  const parsed = ReservedBusinessUserSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Revisá el nombre, correo, contraseña, rol y ubicaciones." };
  try {
    const context = await requireTeamContext("members.invite");
    const clerk = await clerkClient();
    const existing = await clerk.users.getUserList({ emailAddress: [parsed.data.email], limit: 2 });
    const existingUser = existing.data[0];
    const reservedBusinessId = existingUser?.privateMetadata?.mediasisReservedBusinessId;
    const reservedProvisioningId = existingUser?.privateMetadata?.mediasisProvisioningId;
    const canResume = existingUser
      && reservedBusinessId === context.businessId
      && typeof reservedProvisioningId === "string";
    if (existing.totalCount > 0 && !canResume) {
      return { success: false, existingIdentity: true, message: "Este correo ya tiene una cuenta Mediasis. Usá la opción de invitación para conservar su contraseña." };
    }
    const correlationId = canResume ? reservedProvisioningId : parsed.data.correlationId;

    await rpc("prepare_business_member_provisioning", {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_email: parsed.data.email,
      p_display_name: parsed.data.displayName,
      p_mode: "reserved",
      p_business_role_id: parsed.data.roleId,
      p_all_locations: parsed.data.allLocations,
      p_location_ids: parsed.data.locationIds,
      p_correlation_id: correlationId,
    });

    let clerkUserId: string | null = null;
    let clerkMembershipId: string | null = null;
    try {
      const nameParts = parsed.data.displayName.split(/\s+/).filter(Boolean);
      const user = existingUser ?? await clerk.users.createUser({
        emailAddress: [parsed.data.email],
        emailAddressIdentificationStatus: ["reserved"],
        password: parsed.data.password,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || undefined,
        skipLegalChecks: true,
        privateMetadata: {
          mediasisReservedBusinessId: context.businessId,
          mediasisProvisioningId: correlationId,
        },
      });
      clerkUserId = user.id;
      const memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: context.organizationId,
        userId: [user.id],
        limit: 1,
      });
      const membership = memberships.data[0] ?? await clerk.organizations.createOrganizationMembership({ organizationId: context.organizationId, userId: user.id, role: "org:member" });
      clerkMembershipId = membership.id;
      await rpc("record_business_member_external_ids", {
        p_business_id: context.businessId,
        p_correlation_id: correlationId,
        p_clerk_invitation_id: null,
        p_clerk_user_id: clerkUserId,
        p_clerk_membership_id: clerkMembershipId,
        p_error: null,
      });
      await rpc("finalize_reserved_business_member", {
        p_business_id: context.businessId,
        p_correlation_id: correlationId,
        p_clerk_user_id: clerkUserId,
        p_clerk_membership_id: clerkMembershipId,
      });
    } catch (error) {
      await rpc("record_business_member_external_ids", {
        p_business_id: context.businessId,
        p_correlation_id: correlationId,
        p_clerk_invitation_id: null,
        p_clerk_user_id: clerkUserId,
        p_clerk_membership_id: clerkMembershipId,
        p_error: error instanceof Error ? error.message : "Reserved provisioning failed",
      }).catch(() => undefined);
      throw error;
    }
    revalidatePath("/admin/settings/users");
    return { success: true };
  } catch (error) {
    return safeError(error);
  }
}

export async function createOrderingAppUser(): Promise<TeamActionResult> {
  try {
    const context = await requireTeamContext("members.invite");
    const admin = createAdminClient();
    const { data: business, error: businessError } = await admin.schema("mediasis").from("businesses")
      .select("full_name").eq("uid", context.businessId).eq("active", true).maybeSingle();
    if (businessError || !business) throw new Error(businessError?.message ?? "El negocio no está disponible.");

    const operator = await ensureOrderingAppUser({
      admin,
      businessId: context.businessId,
      businessName: business.full_name,
    });
    if (!operator.created) {
      return {
        success: false,
        message: "Este negocio ya tiene un usuario para la App de pedidos. La contraseña existente no fue modificada.",
      };
    }

    const { data: completed, error: completeError } = await admin.schema("mediasis").rpc(
      "complete_legacy_business_supervisor",
      {
        p_business_id: context.businessId,
        p_actor_app_user_id: context.actorAppUserId,
        p_email: operator.email,
      },
    );
    if (completeError || !completed?.success) {
      const { error: rollbackError } = await admin.auth.admin.deleteUser(operator.id, false);
      if (rollbackError) {
        console.error("[Mediasis ordering app user] rollback failed", {
          businessId: context.businessId,
          supabaseUserId: operator.id,
        });
      }
      throw new Error(completeError?.message ?? completed?.message ?? "No se pudo finalizar el usuario de la App de pedidos.");
    }

    revalidatePath("/admin/settings/users");
    return { success: true };
  } catch (error) {
    return safeError(error);
  }
}

export async function saveBusinessRole(input: BusinessRoleInput): Promise<TeamActionResult> {
  const parsed = BusinessRoleSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Indicá un nombre y al menos un permiso." };
  try {
    const context = await requireTeamContext("roles.manage");
    await rpc(parsed.data.roleId ? "update_business_custom_role" : "create_business_custom_role", parsed.data.roleId ? {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_business_role_id: parsed.data.roleId,
      p_name: parsed.data.name,
      p_description: parsed.data.description,
      p_permission_keys: parsed.data.permissionKeys,
    } : {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_name: parsed.data.name,
      p_description: parsed.data.description,
      p_permission_keys: parsed.data.permissionKeys,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    revalidatePath("/admin/settings/users");
    return { success: true };
  } catch (error) { return safeError(error); }
}

export async function archiveBusinessRole(roleId: string): Promise<TeamActionResult> {
  const parsed = RoleIdSchema.safeParse(roleId);
  if (!parsed.success) return { success: false, message: "Rol inválido." };
  try {
    const context = await requireTeamContext("roles.manage");
    await rpc("archive_business_custom_role", {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_business_role_id: parsed.data,
    });
    revalidatePath("/admin/settings/users");
    return { success: true };
  } catch (error) { return safeError(error); }
}

export async function updateBusinessMember(input: UpdateBusinessMemberInput): Promise<TeamActionResult> {
  const parsed = UpdateBusinessMemberSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Revisá el rol y las ubicaciones." };
  try {
    const context = await requireTeamContext("members.read");
    await rpc("update_business_member_access", {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_business_membership_id: parsed.data.membershipId,
      p_business_role_id: parsed.data.roleId,
      p_all_locations: parsed.data.allLocations,
      p_location_ids: parsed.data.locationIds,
    });
    revalidatePath("/admin/settings/users");
    return { success: true };
  } catch (error) { return safeError(error); }
}

export async function changeBusinessMemberStatus(input: MemberStatusInput): Promise<TeamActionResult> {
  const parsed = MemberStatusSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Cambio de estado inválido." };
  try {
    const context = await requireTeamContext("members.remove");
    const result = await rpc("set_business_member_status", {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_business_membership_id: parsed.data.membershipId,
      p_status: parsed.data.status,
    });
    let warning: string | undefined;
    if (parsed.data.status === "revoked" && typeof result.clerk_user_id === "string") {
      try {
        const clerk = await clerkClient();
        await clerk.organizations.deleteOrganizationMembership({
          organizationId: context.organizationId,
          userId: result.clerk_user_id,
        });
      } catch {
        warning = "El acceso Mediasis fue revocado, pero Clerk todavía debe reconciliar la membresía.";
      }
    }
    revalidatePath("/admin/settings/users");
    return { success: true, warning };
  } catch (error) { return safeError(error); }
}

export async function cancelBusinessInvitation(invitationId: string): Promise<TeamActionResult> {
  const parsed = InvitationIdSchema.safeParse(invitationId);
  if (!parsed.success) return { success: false, message: "Invitación inválida." };
  try {
    const context = await requireTeamContext("members.invite");
    const admin = createAdminClient();
    const { data: invitation, error: invitationError } = await admin
      .schema("mediasis")
      .from("business_invitations")
      .select("invited_email, correlation_id, clerk_invitation_id, status")
      .eq("business_invitation_id", parsed.data)
      .eq("business_id", context.businessId)
      .in("status", ["pending", "failed"])
      .maybeSingle();
    if (invitationError || !invitation) {
      throw new Error(invitationError?.message ?? "La invitación ya no está activa.");
    }

    const reconciliation = await reconcileAcceptedBusinessInvitation({
      businessId: context.businessId,
      organizationId: context.organizationId,
      email: invitation.invited_email,
      correlationId: invitation.correlation_id,
    });
    if (reconciliation.reconciled) {
      revalidatePath("/admin/settings/users");
      return {
        success: true,
        message: "La invitación ya había sido aceptada. Se restauró el acceso del usuario; podés eliminarlo desde Miembros si corresponde.",
      };
    }

    if (invitation.clerk_invitation_id) {
      const clerk = await clerkClient();
      try {
        await clerk.organizations.revokeOrganizationInvitation({
          organizationId: context.organizationId,
          invitationId: invitation.clerk_invitation_id,
          ...(context.mode === "clerk" ? { requestingUserId: context.clerkUserId } : {}),
        });
      } catch (error) {
        const acceptedAfterCheck = await reconcileAcceptedBusinessInvitation({
          businessId: context.businessId,
          organizationId: context.organizationId,
          email: invitation.invited_email,
          correlationId: invitation.correlation_id,
        });
        if (acceptedAfterCheck.reconciled) {
          revalidatePath("/admin/settings/users");
          return {
            success: true,
            message: "La invitación fue aceptada mientras se cancelaba. Se restauró el acceso del usuario.",
          };
        }
        throw error;
      }
    }
    const result = await rpc("cancel_business_member_invitation", {
      p_business_id: context.businessId,
      p_actor_app_user_id: context.actorAppUserId,
      p_business_invitation_id: parsed.data,
    });
    revalidatePath("/admin/settings/users");
    return { success: true, message: "Invitación cancelada." };
  } catch (error) { return safeError(error); }
}

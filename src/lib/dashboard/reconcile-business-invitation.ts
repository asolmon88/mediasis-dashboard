import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import { createAdminClient } from "@/lib/supabase/admin";

type ReconcileAcceptedInvitationInput = {
  businessId: string;
  organizationId: string;
  email: string;
  clerkUserId?: string | null;
  correlationId?: string | null;
};

type RpcResult = { success?: boolean; message?: string };

export async function reconcileAcceptedBusinessInvitation({
  businessId,
  organizationId,
  email,
  clerkUserId,
  correlationId,
}: ReconcileAcceptedInvitationInput) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { reconciled: false as const };

  const admin = createAdminClient();
  const { data: mappedBusiness, error: businessError } = await admin
    .schema("mediasis")
    .from("businesses")
    .select("uid")
    .eq("uid", businessId)
    .eq("clerk_organization_id", organizationId)
    .maybeSingle();
  if (businessError) throw new Error(businessError.message);
  if (!mappedBusiness) return { reconciled: false as const };

  const clerk = await clerkClient();
  const users = clerkUserId
    ? { data: [await clerk.users.getUser(clerkUserId)] }
    : await clerk.users.getUserList({ emailAddress: [normalizedEmail], limit: 2 });
  const user = users.data.find((candidate) =>
    candidate.emailAddresses.some(
      (address) => address.emailAddress.trim().toLowerCase() === normalizedEmail,
    ),
  );
  if (!user) return { reconciled: false as const };

  const verifiedEmail = user.emailAddresses.find(
    (address) =>
      address.emailAddress.trim().toLowerCase() === normalizedEmail
      && address.verification?.status === "verified",
  );
  if (!verifiedEmail) return { reconciled: false as const };

  const memberships = await clerk.organizations.getOrganizationMembershipList({
    organizationId,
    userId: [user.id],
    limit: 2,
  });
  const membership = memberships.data[0];
  if (!membership) return { reconciled: false as const };

  let invitationQuery = admin
    .schema("mediasis")
    .from("business_invitations")
    .select("correlation_id")
    .eq("business_id", businessId)
    .eq("invited_email", normalizedEmail)
    .eq("provisioning_mode", "invitation")
    .in("status", ["pending", "failed"]);
  if (correlationId) invitationQuery = invitationQuery.eq("correlation_id", correlationId);
  const { data: invitation, error: invitationError } = await invitationQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (invitationError) throw new Error(invitationError.message);
  if (!invitation) return { reconciled: false as const };

  const { data: recordedData, error: recordedError } = await admin
    .schema("mediasis")
    .rpc("record_business_member_external_ids", {
      p_business_id: businessId,
      p_correlation_id: invitation.correlation_id,
      p_clerk_invitation_id: null,
      p_clerk_user_id: user.id,
      p_clerk_membership_id: membership.id,
      p_error: null,
    });
  const recorded = recordedData as RpcResult | null;
  if (recordedError || !recorded?.success) {
    throw new Error(recordedError?.message ?? recorded?.message ?? "No se pudo registrar la membresía de Clerk.");
  }

  const { data: acceptedData, error: acceptedError } = await admin
    .schema("mediasis")
    .rpc("accept_business_invitation", {
      p_correlation_id: invitation.correlation_id,
      p_clerk_user_id: user.id,
      p_verified_email: verifiedEmail.emailAddress,
      p_clerk_membership_id: membership.id,
    });
  const accepted = acceptedData as RpcResult | null;
  if (acceptedError || !accepted?.success) {
    throw new Error(acceptedError?.message ?? accepted?.message ?? "No se pudo finalizar la invitación.");
  }

  return {
    reconciled: true as const,
    correlationId: invitation.correlation_id,
    clerkUserId: user.id,
    clerkMembershipId: membership.id,
  };
}

export async function reconcileAcceptedBusinessInvitationForUser({
  clerkUserId,
  email,
}: {
  clerkUserId: string;
  email: string;
}) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { reconciled: false as const };

  const admin = createAdminClient();
  const { data: invitations, error: invitationError } = await admin
    .schema("mediasis")
    .from("business_invitations")
    .select("business_id, correlation_id")
    .eq("invited_email", normalizedEmail)
    .eq("provisioning_mode", "invitation")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: false });
  if (invitationError) throw new Error(invitationError.message);
  if (!invitations?.length) return { reconciled: false as const };

  const clerk = await clerkClient();
  const memberships = await clerk.users.getOrganizationMembershipList({
    userId: clerkUserId,
    limit: 100,
  });
  const organizationIds = new Set(
    memberships.data.map((membership) => membership.organization.id),
  );
  if (!organizationIds.size) return { reconciled: false as const };

  const businessIds = Array.from(new Set(invitations.map((invitation) => invitation.business_id)));
  const { data: businesses, error: businessError } = await admin
    .schema("mediasis")
    .from("businesses")
    .select("uid, clerk_organization_id")
    .in("uid", businessIds);
  if (businessError) throw new Error(businessError.message);

  const businessById = new Map(
    (businesses ?? []).map((business) => [business.uid, business.clerk_organization_id]),
  );
  for (const invitation of invitations) {
    const organizationId = businessById.get(invitation.business_id);
    if (!organizationId || !organizationIds.has(organizationId)) continue;

    const result = await reconcileAcceptedBusinessInvitation({
      businessId: invitation.business_id,
      organizationId,
      email: normalizedEmail,
      clerkUserId,
      correlationId: invitation.correlation_id,
    });
    if (result.reconciled) {
      return {
        ...result,
        businessId: invitation.business_id,
        organizationId,
      };
    }
  }

  return { reconciled: false as const };
}

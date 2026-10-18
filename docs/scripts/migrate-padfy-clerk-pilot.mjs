#!/usr/bin/env node

import { createClerkClient } from "@clerk/backend";
import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--confirm-production");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey || !clerkSecretKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CLERK_SECRET_KEY are required.");
}
if (!dryRun && !confirmed) throw new Error("Use --dry-run or explicitly pass --confirm-production.");
if (!dryRun && !clerkSecretKey.startsWith("sk_live_")) {
  throw new Error("The Padfy pilot requires a Production Clerk secret key (sk_live_...).");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const preparedResult = await supabase.schema("mediasis").rpc("prepare_padfy_clerk_pilot");
if (preparedResult.error || !preparedResult.data?.success) {
  throw new Error(preparedResult.error?.message ?? "Unable to prepare the Padfy pilot.");
}
const prepared = preparedResult.data;

if (dryRun) {
  console.table([{
    businessId: prepared.business_id,
    business: prepared.business_name,
    email: prepared.email,
    password: "bcrypt ready",
    organizationMapped: Boolean(prepared.clerk_organization_id),
  }]);
  process.exit(0);
}

const clerk = createClerkClient({ secretKey: clerkSecretKey });
const users = await clerk.users.getUserList({ emailAddress: [prepared.email], limit: 2 });
if (users.totalCount > 1) throw new Error("Clerk returned multiple users for the Padfy email.");
let user = users.data[0] ?? null;
if (user?.banned || user?.locked) throw new Error("The existing Padfy Clerk identity is blocked.");
if (!user) {
  user = await clerk.users.createUser({
    emailAddress: [prepared.email],
    emailAddressIdentificationStatus: ["reserved"],
    passwordDigest: prepared.password_digest,
    passwordHasher: "bcrypt",
    externalId: prepared.business_id,
    skipLegalChecks: true,
  });
}

let organization;
if (prepared.clerk_organization_id) {
  organization = await clerk.organizations.getOrganization({
    organizationId: prepared.clerk_organization_id,
  });
} else {
  // Production has Organization slugs disabled. Private metadata is the
  // deterministic retry key, so a retry after an external success never
  // creates a second Organization for Padfy.
  const organizations = await clerk.organizations.getOrganizationList({
    query: prepared.business_name,
    limit: 100,
  });
  const matchingOrganizations = organizations.data.filter(
    (candidate) => candidate.privateMetadata?.mediasisBusinessId === prepared.business_id
  );
  if (matchingOrganizations.length > 1) {
    throw new Error("More than one Clerk Organization is marked as the Padfy business.");
  }
  organization = matchingOrganizations[0] ?? await clerk.organizations.createOrganization({
    name: prepared.business_name,
    privateMetadata: { mediasisBusinessId: prepared.business_id },
  });
}

const memberships = await clerk.organizations.getOrganizationMembershipList({
  organizationId: organization.id,
  userId: [user.id],
  limit: 2,
});
if (memberships.totalCount > 1) throw new Error("Clerk returned duplicate Padfy memberships.");
let membership = memberships.data[0] ?? null;
if (!membership) {
  membership = await clerk.organizations.createOrganizationMembership({
    organizationId: organization.id,
    userId: user.id,
    role: "org:admin",
  });
} else if (membership.role !== "org:admin") {
  membership = await clerk.organizations.updateOrganizationMembership({
    organizationId: organization.id,
    userId: user.id,
    role: "org:admin",
  });
}

const completed = await supabase.schema("mediasis").rpc("complete_padfy_clerk_pilot", {
  p_clerk_user_id: user.id,
  p_clerk_organization_id: organization.id,
  p_clerk_membership_id: membership.id,
});
if (completed.error || !completed.data?.success) {
  throw new Error(completed.error?.message ?? "Unable to complete the Padfy pilot.");
}

console.table([{
  businessId: prepared.business_id,
  email: prepared.email,
  clerkUserId: user.id,
  organizationId: organization.id,
  membershipId: membership.id,
  status: "ready",
}]);

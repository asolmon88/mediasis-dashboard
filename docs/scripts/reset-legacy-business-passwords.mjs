#!/usr/bin/env node

import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClerkClient } from "@clerk/backend";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const option = (name) => {
  const index = argv.indexOf(name);
  return index < 0 ? null : argv[index + 1] ?? null;
};

const dryRun = hasFlag("--dry-run");
const confirmed = hasFlag("--confirm-production");
const resetAll = hasFlag("--all");
const businessId = option("--business-id");
const outputPath = option("--output");
const batchSize = Number(option("--batch-size") ?? "10");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey || !clerkSecretKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CLERK_SECRET_KEY are required.");
}
if (!clerkSecretKey.startsWith("sk_live_")) {
  throw new Error("This one-time operation requires a Production Clerk secret key.");
}
if (businessId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
  throw new Error("--business-id must be a UUID.");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
  throw new Error("--batch-size must be an integer from 1 through 50.");
}
if (!dryRun && !confirmed) {
  throw new Error("Pass --confirm-production before changing passwords.");
}
if (!dryRun && !resetAll && !businessId) {
  throw new Error("Choose --all or --business-id <uuid>.");
}
if (!dryRun && !outputPath) {
  throw new Error("Pass --output <path.csv> so the changed credentials are stored securely.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const clerk = createClerkClient({ secretKey: clerkSecretKey });

/**
 * This intentionally implements the temporary password convention requested
 * for legacy pharmacy accounts: normalized business name + "124". It is not
 * used for new accounts and should be replaced with user-chosen passwords after
 * the compatibility period.
 */
const passwordForBusiness = (name) => {
  const normalized = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  if (!normalized) throw new Error("Business name cannot produce a password");
  return `${normalized[0].toUpperCase()}${normalized.slice(1)}124`;
};

const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const withRetry = async (operation) => {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = Number(error?.status ?? 0);
      if (status !== 429 && status < 500) throw error;
      if (attempt < 3) await sleep(500 * (2 ** attempt));
    }
  }
  throw lastError;
};

let businessesQuery = supabase
  .schema("mediasis")
  .from("businesses")
  .select("uid,full_name,clerk_organization_id")
  .eq("active", true)
  .order("full_name", { ascending: true });
if (businessId) businessesQuery = businessesQuery.eq("uid", businessId);
const { data: businesses, error: businessesError } = await businessesQuery;
if (businessesError) throw new Error(`Unable to load businesses: ${businessesError.message}`);
if (!businesses?.length) throw new Error("No matching active businesses were found.");

const candidates = [];
for (const business of businesses) {
  const { data: legacyUser, error: legacyUserError } = await supabase.auth.admin.getUserById(business.uid);
  if (legacyUserError || !legacyUser?.user) {
    throw new Error(`Legacy auth user is missing for business ${business.uid}`);
  }
  const email = normalizeEmail(legacyUser.user.email);
  if (!email) throw new Error(`Legacy email is missing for business ${business.uid}`);
  if (!business.clerk_organization_id) {
    throw new Error(`Clerk Organization mapping is missing for business ${business.uid}`);
  }

  const { data: identities, error: identityError } = await supabase
    .schema("mediasis")
    .from("app_users")
    .select("app_user_id,clerk_user_id,primary_email")
    .eq("status", "active")
    .is("deleted_at", null)
    .ilike("primary_email", email)
    .limit(2);
  if (identityError || identities?.length !== 1) {
    throw new Error(`Exactly one active Mediasis identity is required for business ${business.uid}`);
  }

  const identity = identities[0];
  const { data: memberships, error: membershipError } = await supabase
    .schema("mediasis")
    .from("business_memberships")
    .select("business_membership_id,clerk_membership_id,all_locations")
    .eq("business_id", business.uid)
    .eq("app_user_id", identity.app_user_id)
    .eq("status", "active")
    .is("revoked_at", null)
    .limit(2);
  if (membershipError || memberships?.length !== 1 || !memberships[0].clerk_membership_id) {
    throw new Error(`Active Clerk-backed owner membership is missing for business ${business.uid}`);
  }

  const clerkUser = await withRetry(() => clerk.users.getUser(identity.clerk_user_id));
  const clerkEmails = clerkUser.emailAddresses.map((item) => normalizeEmail(item.emailAddress));
  if (!clerkEmails.includes(email)) {
    throw new Error(`Clerk email does not match the legacy email for business ${business.uid}`);
  }
  const organizationMemberships = await withRetry(() =>
    clerk.organizations.getOrganizationMembershipList({
      organizationId: business.clerk_organization_id,
      userId: [identity.clerk_user_id],
      limit: 2,
    }));
  if (organizationMemberships.totalCount !== 1 || organizationMemberships.data[0].role !== "org:admin") {
    throw new Error(`Clerk org:admin membership is invalid for business ${business.uid}`);
  }

  const password = passwordForBusiness(business.full_name);
  if (password.length < 8) throw new Error(`Generated password is too short for business ${business.uid}`);
  candidates.push({
    businessId: business.uid,
    businessName: business.full_name,
    email,
    clerkUserId: identity.clerk_user_id,
    password,
  });
}

const passwordOwners = new Map();
for (const candidate of candidates) {
  const duplicate = passwordOwners.get(candidate.password.toLowerCase());
  if (duplicate) {
    throw new Error(`Businesses ${duplicate} and ${candidate.businessId} generate the same password`);
  }
  passwordOwners.set(candidate.password.toLowerCase(), candidate.businessId);
}

console.table(candidates.map((candidate) => ({
  businessId: candidate.businessId,
  business: candidate.businessName,
  email: candidate.email,
  passwordLength: candidate.password.length,
  ready: true,
})));

if (dryRun) {
  console.log(`Dry run passed for ${candidates.length} business account(s). No passwords were changed or printed.`);
  process.exit(0);
}

const report = [];
for (let start = 0; start < candidates.length; start += batchSize) {
  for (const candidate of candidates.slice(start, start + batchSize)) {
    try {
      // The bypass is deliberate for this one-time plaintext compatibility
      // migration. Clerk documents this flag specifically for migrations.
      await withRetry(() => clerk.users.updateUser(candidate.clerkUserId, {
        password: candidate.password,
        skipPasswordChecks: true,
        signOutOfOtherSessions: true,
      }));
      report.push({ ...candidate, status: "completed", error: "" });
    } catch (error) {
      report.push({
        ...candidate,
        status: "failed",
        error: String(error?.errors?.[0]?.code ?? error?.message ?? "password_update_failed").slice(0, 200),
      });
    }
  }
}

const csv = [
  ["business_id", "business_name", "email", "password", "status", "error"],
  ...report.map((row) => [
    row.businessId, row.businessName, row.email, row.password, row.status, row.error,
  ]),
].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
const resolvedOutputPath = resolve(outputPath);
await writeFile(resolvedOutputPath, csv, { encoding: "utf8", flag: "wx", mode: 0o600 });
await chmod(resolvedOutputPath, 0o600);

const failed = report.filter((row) => row.status !== "completed");
console.table(report.map((row) => ({
  businessId: row.businessId,
  business: row.businessName,
  email: row.email,
  status: row.status,
})));
console.log(`Secure credential report written to ${resolvedOutputPath}.`);
if (failed.length > 0) {
  console.error(`${failed.length} account(s) require a retry. See the report status; passwords were not printed.`);
  process.exitCode = 1;
} else {
  console.log(`Passwords updated in Clerk for ${report.length} business account(s). Supabase Auth was not changed.`);
}

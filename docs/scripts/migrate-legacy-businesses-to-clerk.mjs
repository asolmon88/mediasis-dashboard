#!/usr/bin/env node

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
const migrateAll = hasFlag("--all");
const retryFailed = hasFlag("--retry-failed");
const businessId = option("--business-id");
const batchSize = Number(option("--batch-size") ?? "10");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
if (!clerkSecretKey) throw new Error("CLERK_SECRET_KEY is required for Clerk conflict checks.");
if (!dryRun && !confirmed) throw new Error("Pass --confirm-production before creating Clerk resources.");
if (!clerkSecretKey.startsWith("sk_live_")) {
  throw new Error("The legacy migration requires a Production Clerk secret key.");
}
if (!dryRun && !migrateAll && !businessId) {
  throw new Error("Choose --all or --business-id <uuid>.");
}
if (businessId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
  throw new Error("--business-id must be a UUID.");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
  throw new Error("--batch-size must be an integer from 1 through 50.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const rpc = async (name, args = {}) => {
  const { data, error } = await supabase.schema("mediasis").rpc(name, args);
  if (error || data?.success === false) throw new Error(error?.message ?? data?.message ?? `${name} failed`);
  return data;
};

const preflight = await rpc("get_legacy_business_clerk_migration_preflight", {
  p_business_id: businessId,
});
const rows = preflight.rows ?? [];
console.table(rows.map((row) => ({
  businessId: row.business_id,
  business: row.business_name,
  email: row.email ?? "missing",
  status: row.status ?? "pending",
  ready: row.ready,
  issue: row.failure_code ?? "",
})));

const invalid = rows.filter((row) => !row.ready);
if (invalid.length > 0) {
  console.error(`Preflight failed for ${invalid.length} business(es). No Clerk changes were made.`);
  process.exitCode = 1;
} else if (dryRun) {
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const conflicts = [];
  for (const row of rows) {
    const users = await clerk.users.getUserList({ emailAddress: [row.email], limit: 2 });
    if (users.totalCount > 1) {
      conflicts.push({ businessId: row.business_id, issue: "multiple_clerk_users" });
    } else if (users.data[0]
      && users.data[0].externalId !== row.business_id
      && users.data[0].privateMetadata?.mediasisLegacyBusinessId !== row.business_id) {
      conflicts.push({ businessId: row.business_id, issue: "unrelated_clerk_identity" });
    }

    if (row.organization_mapped) {
      const organization = await clerk.organizations.getOrganization({
        organizationId: row.clerk_organization_id,
      });
      if (organization.privateMetadata?.mediasisBusinessId !== row.business_id) {
        conflicts.push({ businessId: row.business_id, issue: "organization_metadata_mismatch" });
      }
    } else {
      const organizations = await clerk.organizations.getOrganizationList({
        query: row.business_name,
        limit: 100,
      });
      if (organizations.data.filter(
        (item) => item.privateMetadata?.mediasisBusinessId === row.business_id,
      ).length > 1) {
        conflicts.push({ businessId: row.business_id, issue: "multiple_clerk_organizations" });
      }
    }
  }
  if (conflicts.length > 0) {
    console.table(conflicts);
    console.error(`Clerk conflict checks failed for ${conflicts.length} business(es). No Clerk changes were made.`);
    process.exitCode = 1;
  } else {
    console.log(`Preflight passed for ${rows.length} business(es). No Clerk changes were made.`);
  }
} else {
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const pending = rows.filter((row) => {
    if (row.status === "completed") return false;
    if (["failed", "conflict"].includes(row.status) && !retryFailed) return false;
    return true;
  });
  const selected = businessId ? pending : (migrateAll ? pending : []);
  const report = [];

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  const checkpoint = (id, status, ids) => rpc("checkpoint_legacy_business_clerk_migration", {
    p_business_id: id,
    p_status: status,
    p_clerk_user_id: ids.userId ?? null,
    p_clerk_organization_id: ids.organizationId ?? null,
    p_clerk_membership_id: ids.membershipId ?? null,
  });

  const safeError = (error) => {
    const code = error?.errors?.[0]?.code ?? error?.code ?? "migration_failed";
    const message = error?.errors?.[0]?.message ?? error?.message ?? "Migration failed";
    return { code: String(code).slice(0, 100), message: String(message).slice(0, 500) };
  };
  const isConflict = (error) => [
    "email_address_exists", "form_identifier_exists", "external_id_exists",
  ].includes(error?.errors?.[0]?.code) || /different|multiple|another|conflict/i.test(error?.message ?? "");

  const migrateBusiness = async (candidate) => {
    const prepared = await rpc("prepare_legacy_business_clerk_migration", {
      p_business_id: candidate.business_id,
    });
    const ids = {
      userId: prepared.clerk_user_id ?? null,
      organizationId: prepared.clerk_organization_id ?? null,
      membershipId: prepared.clerk_membership_id ?? null,
    };

    let user;
    if (ids.userId) {
      user = await withRetry(() => clerk.users.getUser(ids.userId));
    } else {
      const users = await withRetry(() => clerk.users.getUserList({
        emailAddress: [prepared.email], limit: 2,
      }));
      if (users.totalCount > 1) throw new Error("Multiple Clerk users use the legacy email");
      user = users.data[0] ?? null;
      if (user) {
        const markedBusinessId = user.privateMetadata?.mediasisLegacyBusinessId;
        if (user.externalId !== prepared.business_id && markedBusinessId !== prepared.business_id) {
          throw new Error("Existing Clerk identity is not mapped to this legacy business");
        }
      } else {
        user = await withRetry(() => clerk.users.createUser({
          emailAddress: [prepared.email],
          emailAddressIdentificationStatus: ["reserved"],
          passwordDigest: prepared.password_digest,
          passwordHasher: "bcrypt",
          externalId: prepared.business_id,
          skipLegalChecks: true,
          privateMetadata: {
            mediasisLegacyMigration: true,
            mediasisLegacyBusinessId: prepared.business_id,
          },
        }));
      }
      ids.userId = user.id;
      await checkpoint(prepared.business_id, "user_created", ids);
    }
    if (user.banned || user.locked) throw new Error("The Clerk identity is blocked");

    let organization;
    if (ids.organizationId) {
      organization = await withRetry(() => clerk.organizations.getOrganization({
        organizationId: ids.organizationId,
      }));
    } else {
      const organizations = await withRetry(() => clerk.organizations.getOrganizationList({
        query: prepared.business_name,
        limit: 100,
      }));
      const matching = organizations.data.filter(
        (item) => item.privateMetadata?.mediasisBusinessId === prepared.business_id,
      );
      if (matching.length > 1) throw new Error("Multiple Clerk Organizations are mapped to this business");
      organization = matching[0] ?? await withRetry(() => clerk.organizations.createOrganization({
        name: prepared.business_name,
        privateMetadata: { mediasisBusinessId: prepared.business_id },
      }));
      ids.organizationId = organization.id;
      await checkpoint(prepared.business_id, "organization_created", ids);
    }
    if (organization.privateMetadata?.mediasisBusinessId !== prepared.business_id) {
      throw new Error("Clerk Organization metadata belongs to another business");
    }

    let membership;
    const memberships = await withRetry(() => clerk.organizations.getOrganizationMembershipList({
      organizationId: organization.id,
      userId: [user.id],
      limit: 2,
    }));
    if (memberships.totalCount > 1) throw new Error("Multiple Clerk memberships exist for this owner");
    membership = memberships.data[0] ?? await withRetry(() =>
      clerk.organizations.createOrganizationMembership({
        organizationId: organization.id,
        userId: user.id,
        role: "org:admin",
      }));
    if (membership.role !== "org:admin") {
      membership = await withRetry(() => clerk.organizations.updateOrganizationMembership({
        organizationId: organization.id,
        userId: user.id,
        role: "org:admin",
      }));
    }
    ids.membershipId = membership.id;
    await checkpoint(prepared.business_id, "membership_created", ids);
    await rpc("complete_legacy_business_clerk_migration", {
      p_business_id: prepared.business_id,
      p_clerk_user_id: ids.userId,
      p_clerk_organization_id: ids.organizationId,
      p_clerk_membership_id: ids.membershipId,
    });
    return { businessId: prepared.business_id, business: prepared.business_name, status: "completed" };
  };

  for (let start = 0; start < selected.length; start += batchSize) {
    const batch = selected.slice(start, start + batchSize);
    for (const candidate of batch) {
      try {
        report.push(await migrateBusiness(candidate));
      } catch (error) {
        const safe = safeError(error);
        const conflict = isConflict(error);
        await rpc("fail_legacy_business_clerk_migration", {
          p_business_id: candidate.business_id,
          p_error_code: safe.code,
          p_error: safe.message,
          p_conflict: conflict,
        }).catch(() => undefined);
        report.push({
          businessId: candidate.business_id,
          business: candidate.business_name,
          status: conflict ? "conflict" : "failed",
          issue: safe.code,
        });
      }
    }
  }

  console.table(report);
  const verification = await rpc("verify_legacy_business_clerk_migration");
  console.log(JSON.stringify(verification, null, 2));
  if (report.some((item) => item.status !== "completed") || (migrateAll && verification.incomplete > 0)) {
    process.exitCode = 1;
  }
}

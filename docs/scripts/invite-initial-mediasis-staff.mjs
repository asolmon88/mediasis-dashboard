#!/usr/bin/env node

import { createClerkClient } from "@clerk/backend";

const approvedEmails = ["alejandrog@eatsycr.com", "ariel.solis@eatsycr.com"];
const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--confirm-production");
const replacePending = process.argv.includes("--replace-pending");
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const redirectArgumentIndex = process.argv.indexOf("--redirect-url");
const explicitRedirectUrl = redirectArgumentIndex >= 0
  ? process.argv[redirectArgumentIndex + 1]?.trim()
  : null;
const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL?.trim() || null;

if (!clerkSecretKey || (!explicitRedirectUrl && !dashboardBaseUrl)) {
  throw new Error("CLERK_SECRET_KEY and either DASHBOARD_BASE_URL or --redirect-url are required.");
}
if (!dryRun && !confirmed) {
  throw new Error("Use --dry-run or explicitly pass --confirm-production.");
}
if (!dryRun && !clerkSecretKey.startsWith("sk_live_")) {
  throw new Error("Initial staff invitations require a Production Clerk secret key.");
}

const redirectUrl = explicitRedirectUrl
  ? new URL(explicitRedirectUrl)
  : new URL("/clerk-auth/sign-up?redirect_url=/admin", new URL(dashboardBaseUrl));
const approvedHosts = new Set(["local.mediasis.cr", "dashboard.mediasis.cr"]);
if (redirectUrl.protocol !== "https:" || !approvedHosts.has(redirectUrl.hostname)) {
  throw new Error("The invitation redirect must use HTTPS on an approved Mediasis dashboard hostname.");
}
if (redirectUrl.pathname !== "/clerk-auth/sign-up" || redirectUrl.searchParams.get("redirect_url") !== "/admin") {
  throw new Error("The invitation redirect must target /clerk-auth/sign-up?redirect_url=/admin.");
}
const clerk = createClerkClient({ secretKey: clerkSecretKey });
const report = [];

for (const email of approvedEmails) {
  const users = await clerk.users.getUserList({ emailAddress: [email], limit: 2 });
  if (users.totalCount > 1) throw new Error(`Clerk returned duplicate users for ${email}.`);
  if (users.data[0]) {
    report.push({ email, status: "existing-user", clerkUserId: users.data[0].id });
    continue;
  }

  const invitations = await clerk.invitations.getInvitationList({ query: email, limit: 100 });
  const activeInvitation = invitations.data.find(
    (invitation) => invitation.emailAddress.toLowerCase() === email && invitation.status === "pending",
  );
  if (activeInvitation) {
    if (!replacePending || dryRun) {
      report.push({
        email,
        status: replacePending ? "would-replace-pending" : "invitation-pending",
        invitationId: activeInvitation.id,
      });
      continue;
    }
    await clerk.invitations.revokeInvitation(activeInvitation.id);
  }

  if (dryRun) {
    report.push({ email, status: "would-invite" });
    continue;
  }

  const invitation = await clerk.invitations.createInvitation({
    emailAddress: email,
    notify: true,
    expiresInDays: 30,
    redirectUrl: redirectUrl.toString(),
    publicMetadata: { mediasisInitialStaff: true },
  });
  report.push({ email, status: "invited", invitationId: invitation.id });
}

console.table(report);
console.log(`Invitation redirect: ${redirectUrl.toString()}`);
console.log("Staff access is granted idempotently on the first dashboard sign-in after migration 058 is applied.");

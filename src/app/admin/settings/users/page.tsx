import { notFound } from "next/navigation";

import { TeamManagementPanel } from "@/components/team/TeamManagementPanel";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";

import { getBusinessTeamData } from "./actions";

export default async function BusinessUsersPage() {
  const context = await getDashboardAuthorizationContext();
  if (
    !context ||
    context.mode === "legacy" ||
    !context.activeBusinessId ||
    !context.activeClerkOrganizationId ||
    !hasDashboardPermission(context, "members.read")
  ) {
    notFound();
  }

  const data = await getBusinessTeamData();
  return <TeamManagementPanel data={data} />;
}

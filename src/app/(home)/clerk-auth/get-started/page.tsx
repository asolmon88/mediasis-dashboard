import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { MediasisSignup } from "@/components/auth/mediasis-signup";
import { getPublicSignupCatalog } from "@/lib/dashboard/merchant-onboarding";

export default async function GetStartedPage() {
  const session = await auth();
  if (session.userId) redirect("/admin");
  const catalog = await getPublicSignupCatalog();
  return <MediasisSignup catalog={catalog} />;
}

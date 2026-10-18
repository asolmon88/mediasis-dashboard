import AccountLifecycleClient from "@/app/(home)/clerk-auth/account/AccountLifecycleClient";
import { getAccountLifecycleData } from "@/app/(home)/clerk-auth/account/actions";

export default async function DashboardAccountPage() {
  const data = await getAccountLifecycleData();
  return <AccountLifecycleClient data={data} />;
}

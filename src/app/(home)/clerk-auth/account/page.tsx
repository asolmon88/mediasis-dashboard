import { redirect } from "next/navigation";

export default async function AccountLifecyclePage() {
  redirect("/admin/account");
}

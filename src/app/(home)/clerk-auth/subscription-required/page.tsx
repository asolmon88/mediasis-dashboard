import { redirect } from "next/navigation";

export default function SubscriptionRequiredPage() {
  redirect("/admin");
}

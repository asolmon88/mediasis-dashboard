import { redirect } from "next/navigation";

export default function TrialExpiredPage() {
  redirect("/admin");
}

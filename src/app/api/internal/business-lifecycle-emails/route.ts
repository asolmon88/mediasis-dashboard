import { NextResponse } from "next/server";

import { sendBusinessLifecycleEmail, type BusinessLifecycleEmail } from "@/lib/emails/business-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const admin = createAdminClient();
  const { data: claimed, error } = await admin.schema("mediasis")
    .rpc("claim_due_business_lifecycle_emails", { p_limit: 20 });
  if (error) {
    console.error("Business lifecycle email claim failed", error);
    return NextResponse.json({ error: "Business lifecycle email claim failed" }, { status: 500 });
  }
  let sent = 0;
  await Promise.allSettled((claimed ?? []).map(async (row: BusinessLifecycleEmail & { claim_token: string }) => {
    const result = await sendBusinessLifecycleEmail(row);
    const { error: finishError } = await admin.schema("mediasis").rpc("finish_business_lifecycle_email", {
      p_business_lifecycle_email_id: row.business_lifecycle_email_id,
      p_claim_token: row.claim_token,
      p_success: result.success,
      p_brevo_message_id: result.messageId ?? null,
      p_error: result.success ? null : result.message,
    });
    if (finishError) console.error("Could not record business lifecycle email", { emailId: row.business_lifecycle_email_id, error: finishError });
    if (result.success) sent++;
  }));
  return NextResponse.json({ claimed: claimed?.length ?? 0, sent });
}

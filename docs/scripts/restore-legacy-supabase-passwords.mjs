#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const confirmed = argv.includes("--confirm-production");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEGACY_PASSWORD = "E12345678";

if (!confirmed) throw new Error("Pass --confirm-production to restore legacy business passwords.");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: businesses, error: businessesError } = await supabase
  .schema("mediasis")
  .from("businesses")
  .select("uid,full_name")
  .eq("active", true)
  .order("full_name", { ascending: true });
if (businessesError) throw new Error(`Unable to load active businesses: ${businessesError.message}`);
if (!businesses?.length) throw new Error("No active legacy businesses were found.");

const verified = [];
for (const business of businesses) {
  const { data, error } = await supabase.auth.admin.getUserById(business.uid);
  if (error || !data?.user?.email) {
    throw new Error(`Legacy Supabase Auth user is missing for business ${business.uid}`);
  }
  verified.push({ businessId: business.uid, business: business.full_name, email: data.user.email });
}

// Complete the read-only target validation before changing the first password.
if (verified.length !== businesses.length) throw new Error("Not every active business has a legacy Auth user.");

const results = [];
for (const account of verified) {
  const { error } = await supabase.auth.admin.updateUserById(account.businessId, {
    password: LEGACY_PASSWORD,
  });
  results.push({ ...account, status: error ? "failed" : "restored", error: error?.message ?? "" });
}

console.table(results.map(({ businessId, business, email, status }) => ({
  businessId, business, email, status,
})));
const failed = results.filter((result) => result.status !== "restored");
if (failed.length) {
  console.error(`${failed.length} legacy account(s) failed. Rerunning is safe.`);
  process.exitCode = 1;
} else {
  console.log(`Restored the legacy Supabase password for ${results.length} active business account(s).`);
}

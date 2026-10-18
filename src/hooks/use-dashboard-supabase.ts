"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { useCallback, useMemo } from "react";

import { useDashboardClerkToken } from "@/components/auth/DashboardClerkProvider";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
import { createClient as createLegacyClient } from "@/lib/supabase/client";

export function useDashboardSupabase() {
  const authorization = useDashboardAuthorization();
  const getDashboardToken = useDashboardClerkToken();

  return useMemo(() => {
    if (authorization.mode === "legacy") return createLegacyClient();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.error("[Mediasis dashboard Supabase]", {
        stage: "configuration-missing",
        supabaseUrlPresent: Boolean(supabaseUrl),
        supabaseKeyPresent: Boolean(supabaseKey),
      });
      throw new Error("Supabase browser configuration is missing.");
    }
    console.info("[Mediasis dashboard Supabase]", {
      stage: "client-created",
      mode: authorization.mode,
      supabaseUrlPresent: true,
      supabaseKeyPresent: true,
      clerkTokenProviderPresent: Boolean(getDashboardToken),
    });
    return createSupabaseClient(
      supabaseUrl,
      supabaseKey,
      {
        accessToken: async () => (getDashboardToken ? await getDashboardToken() : null),
        // Supabase normally derives this header from the constructor key. Keep
        // it explicit for externally supplied Clerk access tokens so PostgREST
        // always receives both the project key and the user's JWT.
        global: { headers: { apikey: supabaseKey } },
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      },
    );
  }, [authorization.mode, getDashboardToken]);
}

export function useDashboardAccessToken() {
  const authorization = useDashboardAuthorization();
  const getDashboardToken = useDashboardClerkToken();
  return useCallback(async () => {
    if (authorization.mode !== "legacy") {
      return getDashboardToken ? await getDashboardToken() : null;
    }
    const { data } = await createLegacyClient().auth.getSession();
    return data.session?.access_token ?? null;
  }, [authorization.mode, getDashboardToken]);
}

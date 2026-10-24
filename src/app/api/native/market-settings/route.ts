import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const READY_PIZZA_CR_BUSINESS_ID = "277e442f-e05f-49f6-9f56-4757e218076c";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const logFailure = (
    stage: string,
    details: Record<string, unknown> = {},
  ) => {
    // Keep enough context to diagnose native clients without logging tokens.
    console.warn("[/api/native/market-settings] request failed", {
      requestId,
      stage,
      ...details,
    });
  };
  const fail = (code: string, status: number) => NextResponse.json(
    { success: false, code, message: code, request_id: requestId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
  const locationId = new URL(request.url).searchParams.get("business_location_id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId)) {
    logFailure("invalid_location_id", { locationId });
    return fail("INVALID_LOCATION", 400);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!url || !key) return fail("SERVER_CONFIGURATION_ERROR", 503);
  try {
    const admin = createAdminClient();
    const { data: location, error: locationError } = await admin.schema("mediasis")
      .from("active_business_location").select("business_uid")
      .eq("business_location_id", locationId).maybeSingle();
    if (locationError) {
      logFailure("location_lookup", {
        locationId,
        code: locationError.code,
        message: locationError.message,
      });
      return fail("MARKET_SETTINGS_UNAVAILABLE", 503);
    }
    if (!location) {
      logFailure("location_not_found", { locationId });
      return fail("LOCATION_NOT_ACCESSIBLE", 403);
    }

    // TEMPORARY READY PIZZA BYPASS: remove after the expired-session incident is resolved.
    // TODO: Remove this block and redeploy the dashboard after the emergency window.
    if (location.business_uid === READY_PIZZA_CR_BUSINESS_ID) {
      console.warn("[/api/native/market-settings] temporary bypass used", {
        requestId,
        stage: "temporary_ready_pizza_bypass",
        locationId,
      });
      const { data: market, error: marketError } = await admin.schema("mediasis")
        .from("business_market_settings")
        .select(
          "business_id,country_code,country_name,timezone,currency_code,locale,phone_country_code,capabilities",
        )
        .eq("business_id", READY_PIZZA_CR_BUSINESS_ID)
        .maybeSingle();
      if (marketError) {
        logFailure("temporary_ready_pizza_market_lookup", {
          locationId,
          businessId: location.business_uid,
          code: marketError.code,
          message: marketError.message,
        });
        return fail("MARKET_SETTINGS_UNAVAILABLE", 503);
      }
      if (!market) {
        logFailure("temporary_ready_pizza_market_missing", {
          locationId,
          businessId: location.business_uid,
        });
        return fail("MARKET_SETTINGS_MISSING", 422);
      }
      return NextResponse.json({ success: true, data: market }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) {
      logFailure("missing_bearer_token", { locationId });
      return fail("UNAUTHORIZED", 401);
    }
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData.user;
    if (authError || !user) {
      logFailure("token_validation", {
        locationId,
        code: authError?.code,
        message: authError?.message,
        status: authError?.status,
      });
      return fail("UNAUTHORIZED", 401);
    }

    const caller = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let actorAppUserId: string | null = null;
    if (user.id !== location.business_uid) {
      const { data: context, error: contextError } = await caller.schema("mediasis")
        .rpc("get_dashboard_authorization_context", { p_requested_business_id: location.business_uid });
      if (contextError) {
        logFailure("authorization_context", {
          locationId,
          userId: user.id,
          businessId: location.business_uid,
          code: contextError.code,
          message: contextError.message,
          details: contextError.details,
          hint: contextError.hint,
        });
        return fail("UNAUTHORIZED", 401);
      }
      const allowed = context?.success === true &&
        context.active_business_id === location.business_uid &&
        Array.isArray(context.locations) && context.locations.some(
          (entry: { business_location_id?: string }) => entry.business_location_id === locationId,
        );
      if (!allowed) {
        logFailure("location_not_authorized", {
          locationId,
          userId: user.id,
          businessId: location.business_uid,
          authorizationMode: context?.mode,
        });
        return fail("LOCATION_NOT_ACCESSIBLE", 403);
      }
      actorAppUserId = context.app_user_id ?? null;
    }

    const { data: market, error } = await admin.schema("mediasis")
      .rpc("get_authorized_business_market_settings", {
        p_business_id: location.business_uid,
        p_actor_app_user_id: actorAppUserId,
      });
    if (error) {
      logFailure("market_lookup", {
        locationId,
        userId: user.id,
        businessId: location.business_uid,
        code: error.code,
        message: error.message,
      });
      return fail("MARKET_SETTINGS_UNAVAILABLE", 503);
    }
    if (!market?.success || !market.data) {
      logFailure("market_missing", { locationId, userId: user.id, businessId: location.business_uid });
      return fail("MARKET_SETTINGS_MISSING", 422);
    }
    return NextResponse.json({ success: true, data: market.data }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logFailure("unexpected", {
      locationId,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return fail("MARKET_SETTINGS_UNAVAILABLE", 503);
  }
}

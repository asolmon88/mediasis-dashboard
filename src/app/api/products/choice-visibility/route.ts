import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Choice visibility toggle endpoint for native tablet app.
 *
 * Endpoint:
 * POST /api/products/choice-visibility
 *
 * Purpose:
 * Shows or hides a product option choice at a specific business location.
 * Business logic:
 * - hide from location X: if scope="all" → change to "specific" with all other locations;
 *   if scope="specific" → remove X; if no entries remain → set active=false.
 * - show at location X: if active=false → set active=true; add X to locations;
 *   if all business locations now covered → set scope="all" and clear location entries.
 *
 * Authentication:
 * Send the current logged-in Supabase access token in the Authorization header.
 *
 * Required headers:
 * Content-Type: application/json
 * Authorization: Bearer <supabase_access_token>
 *
 * Request body:
 * {
 *   "product_option_choice_id": "uuid",
 *   "business_location_id": "uuid",
 *   "visible": true
 * }
 *
 * Success response (200):
 * { "success": true }
 *
 * Failure response examples:
 * { "success": false, "message": "No autorizado" }
 * { "success": false, "message": "Choice not found" }
 *
 * Common HTTP statuses:
 * 200 -> Request processed, check `success`
 * 400 -> Invalid body or missing required fields
 * 401 -> Missing or invalid bearer token
 * 500 -> Server/env configuration error
 */

type RequestBody = {
  product_option_choice_id?: string;
  business_location_id?: string;
  visible?: boolean;
};

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, message: "Missing Authorization bearer token" },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { success: false, message: "Supabase env vars are not configured" },
      { status: 500 }
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const choiceId =
    typeof body.product_option_choice_id === "string"
      ? body.product_option_choice_id
      : "";
  const locationId =
    typeof body.business_location_id === "string" ? body.business_location_id : "";
  const visible = typeof body.visible === "boolean" ? body.visible : null;

  if (!choiceId || !locationId || visible === null) {
    return NextResponse.json(
      {
        success: false,
        message:
          "product_option_choice_id, business_location_id, and visible are required",
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json(
      { success: false, message: "No autorizado" },
      { status: 401 }
    );
  }

  // Fetch choice state + business_id via join
  const { data: choiceRow, error: choiceErr } = await supabase
    .schema("mediasis")
    .from("product_option_choices")
    .select(
      `
      scope,
      active,
      product_options!inner(
        product_option_groups!inner(
          business_id
        )
      )
    `
    )
    .eq("product_option_choice_id", choiceId)
    .single();

  if (choiceErr || !choiceRow) {
    return NextResponse.json(
      { success: false, message: "Choice not found" },
      { status: 400 }
    );
  }

  const scope = choiceRow.scope as string;
  const active = choiceRow.active as boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const businessId = (choiceRow as any).product_options?.product_option_groups?.business_id as string;

  // Fetch all business location IDs
  const { data: allLocRows } = await supabase
    .schema("mediasis")
    .from("business_location")
    .select("business_location_id")
    .eq("business_uid", businessId)
    .is("archived_at", null);

  const allLocationIds: string[] = (allLocRows ?? []).map(
    (r: { business_location_id: string }) => r.business_location_id
  );

  // Fetch current specific locations for this choice
  const { data: currentLocRows } = await supabase
    .schema("mediasis")
    .from("product_option_choice_locations")
    .select("business_location_id")
    .eq("product_option_choice_id", choiceId);

  const currentLocationIds: string[] = (currentLocRows ?? []).map(
    (r: { business_location_id: string }) => r.business_location_id
  );

  if (visible) {
    // Already fully visible — nothing to do
    if (scope === "all" && active) {
      return NextResponse.json({ success: true });
    }

    // Restore active flag
    if (!active) {
      await supabase
        .schema("mediasis")
        .from("product_option_choices")
        .update({ active: true })
        .eq("product_option_choice_id", choiceId);
    }

    if (scope === "specific") {
      // Add location (ignore if already there)
      if (!currentLocationIds.includes(locationId)) {
        await supabase
          .schema("mediasis")
          .from("product_option_choice_locations")
          .upsert(
            { product_option_choice_id: choiceId, business_location_id: locationId },
            { onConflict: "product_option_choice_id,business_location_id" }
          );
      }

      const coveredIds = Array.from(
        new Set([...currentLocationIds, locationId])
      );
      const allCovered = allLocationIds.every((id) => coveredIds.includes(id));

      if (allCovered) {
        // Promote to scope="all", clear location entries
        await supabase
          .schema("mediasis")
          .from("product_option_choice_locations")
          .delete()
          .eq("product_option_choice_id", choiceId);

        await supabase
          .schema("mediasis")
          .from("product_option_choices")
          .update({ scope: "all" })
          .eq("product_option_choice_id", choiceId);
      }
    }
  } else {
    // Already hidden — nothing to do
    if (!active) {
      return NextResponse.json({ success: true });
    }

    if (scope === "all") {
      // Flip to specific with all locations except the target
      await supabase
        .schema("mediasis")
        .from("product_option_choices")
        .update({ scope: "specific" })
        .eq("product_option_choice_id", choiceId);

      const otherLocations = allLocationIds.filter((id) => id !== locationId);
      if (otherLocations.length > 0) {
        await supabase
          .schema("mediasis")
          .from("product_option_choice_locations")
          .insert(
            otherLocations.map((loc_id) => ({
              product_option_choice_id: choiceId,
              business_location_id: loc_id,
            }))
          );
      } else {
        // Only one location in this business — hiding it means fully hidden
        await supabase
          .schema("mediasis")
          .from("product_option_choices")
          .update({ active: false })
          .eq("product_option_choice_id", choiceId);
      }
    } else if (scope === "specific") {
      // Remove the location entry
      await supabase
        .schema("mediasis")
        .from("product_option_choice_locations")
        .delete()
        .eq("product_option_choice_id", choiceId)
        .eq("business_location_id", locationId);

      const remaining = currentLocationIds.filter((id) => id !== locationId);
      if (remaining.length === 0) {
        await supabase
          .schema("mediasis")
          .from("product_option_choices")
          .update({ active: false })
          .eq("product_option_choice_id", choiceId);
      }
    }
  }

  return NextResponse.json({ success: true });
}

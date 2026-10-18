import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Fetch all product option groups (and their options + choices) for a product,
 * with per-location choice visibility resolved.
 *
 * Endpoint:
 * GET /api/products/options?product_id=<uuid>&business_location_id=<uuid>
 *
 * Options are returned as read-only headers — they cannot be toggled.
 * Each choice has a `visible_at_location` flag computed from:
 *   scope='all'      → true
 *   scope='specific' → true only if a row exists in product_option_choice_locations
 *                      for this business_location_id
 *
 * Authentication:
 * Authorization: Bearer <supabase_access_token>
 *
 * Success response (200):
 * { "success": true, "data": [
 *   {
 *     "product_option_id": "...",
 *     "name": "Escoge tu bebida",
 *     "type": "selection",
 *     "sequence": 1,
 *     "group_kind": "extra",
 *     "group_name": "Bebidas",
 *     "choices": [
 *       { "product_option_choice_id": "...", "name": "Coca-Cola",
 *         "price": 1800, "visible_at_location": true }
 *     ]
 *   }
 * ]}
 */

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function GET(request: Request): Promise<NextResponse> {
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

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id") ?? "";
  const businessLocationId = searchParams.get("business_location_id") ?? "";

  if (!productId || !businessLocationId) {
    return NextResponse.json(
      {
        success: false,
        message: "product_id and business_location_id are required",
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

  // 1. Fetch all active option groups attached to the product (all kinds)
  const { data: groupProducts, error: groupErr } = await supabase
    .schema("mediasis")
    .from("product_option_group_products")
    .select(
      `
      product_option_group_id,
      sequence,
      product_option_groups!inner(
        name,
        kind
      )
    `
    )
    .eq("product_id", productId)
    .eq("active", true)
    .eq("product_option_groups.active", true)
    .order("sequence");

  if (groupErr) {
    console.error("[/api/products/options] Error fetching groups:", groupErr);
    return NextResponse.json(
      { success: false, message: "Error fetching option groups" },
      { status: 500 }
    );
  }

  if (!groupProducts || groupProducts.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const groupIds = groupProducts.map((gp) => gp.product_option_group_id);

  // Build group metadata lookup
  type GroupProduct = {
    product_option_group_id: string;
    sequence: number;
    product_option_groups: { name: string; kind: string } | { name: string; kind: string }[] | null;
  };
  const groupMeta = new Map<string, { name: string; kind: string; sequence: number }>();
  for (const gp of groupProducts as GroupProduct[]) {
    const pog = Array.isArray(gp.product_option_groups)
      ? gp.product_option_groups[0]
      : gp.product_option_groups;
    if (!pog) continue;
    groupMeta.set(gp.product_option_group_id, {
      name: pog.name,
      kind: pog.kind,
      sequence: gp.sequence,
    });
  }

  // 2. Fetch all active options for these groups
  const { data: options, error: optionsErr } = await supabase
    .schema("mediasis")
    .from("product_options")
    .select("product_option_id, product_option_group_id, name, type, sequence")
    .in("product_option_group_id", groupIds)
    .eq("active", true)
    .order("sequence");

  if (optionsErr) {
    console.error("[/api/products/options] Error fetching options:", optionsErr);
    return NextResponse.json(
      { success: false, message: "Error fetching options" },
      { status: 500 }
    );
  }

  if (!options || options.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const optionIds = options.map((o) => o.product_option_id);

  // 3. Fetch ALL choices for these options (including active=false so hidden ones still appear)
  const { data: choices, error: choicesErr } = await supabase
    .schema("mediasis")
    .from("product_option_choices")
    .select("product_option_choice_id, product_option_id, name, price, scope, active, sequence")
    .in("product_option_id", optionIds)
    .order("sequence");

  if (choicesErr) {
    console.error("[/api/products/options] Error fetching choices:", choicesErr);
    return NextResponse.json(
      { success: false, message: "Error fetching choices" },
      { status: 500 }
    );
  }

  const allChoices = choices ?? [];
  const choiceIds = allChoices.map((c) => c.product_option_choice_id);

  // 4. Fetch specific-scope location entries for this location to resolve visible_at_location
  let visibleSpecificChoiceIds = new Set<string>();
  if (choiceIds.length > 0) {
    const { data: locationRows } = await supabase
      .schema("mediasis")
      .from("product_option_choice_locations")
      .select("product_option_choice_id")
      .in("product_option_choice_id", choiceIds)
      .eq("business_location_id", businessLocationId);

    visibleSpecificChoiceIds = new Set(
      (locationRows ?? []).map(
        (r: { product_option_choice_id: string }) => r.product_option_choice_id
      )
    );
  }

  // 5. Build choices grouped by option_id
  type ChoiceRow = {
    product_option_choice_id: string;
    product_option_id: string;
    name: string;
    price: number;
    scope: string;
    active: boolean;
    sequence: number;
  };
  const choicesByOptionId = new Map<string, ChoiceRow[]>();
  for (const choice of allChoices as ChoiceRow[]) {
    const list = choicesByOptionId.get(choice.product_option_id) ?? [];
    list.push(choice);
    choicesByOptionId.set(choice.product_option_id, list);
  }

  // 6. Build final response — options ordered by group sequence, then option sequence
  const data = options
    .map((o) => {
      const optionChoices = choicesByOptionId.get(o.product_option_id) ?? [];
      const meta = groupMeta.get(o.product_option_group_id);

      return {
        product_option_id: o.product_option_id,
        name: o.name,
        type: o.type,
        sequence: o.sequence,
        group_sequence: meta?.sequence ?? 0,
        group_kind: meta?.kind ?? "general",
        group_name: meta?.name ?? "",
        choices: optionChoices.map((c) => ({
          product_option_choice_id: c.product_option_choice_id,
          name: c.name,
          price: Number(c.price),
          visible_at_location:
            !!c.active &&
            (c.scope === "all" || visibleSpecificChoiceIds.has(c.product_option_choice_id)),
        })),
      };
    })
    .sort((a, b) =>
      a.group_sequence !== b.group_sequence
        ? a.group_sequence - b.group_sequence
        : a.sequence - b.sequence
    )
    .map(({ group_sequence: _gs, ...rest }) => rest);

  return NextResponse.json({ success: true, data });
}

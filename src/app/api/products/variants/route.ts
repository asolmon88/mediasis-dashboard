import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, message: "Missing Authorization bearer token" },
      { status: 401 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { success: false, message: "Supabase env vars are not configured" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id") ?? "";
  const locationId = searchParams.get("business_location_id") ?? "";
  if (!productId || !locationId) {
    return NextResponse.json(
      {
        success: false,
        message: "product_id and business_location_id are required",
      },
      { status: 400 },
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
      { status: 401 },
    );
  }

  const { data, error } = await supabase
    .schema("mediasis")
    .rpc("get_product_variants_for_app", {
      p_product_id: productId,
      p_business_location_id: locationId,
    });

  if (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 400 },
    );
  }

  const result = (data ?? {}) as { success?: boolean; message?: string };
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

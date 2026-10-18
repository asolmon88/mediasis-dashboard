import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type RequestBody = {
  product_id?: string;
  business_location_id?: string;
  visible?: boolean;
};

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

export async function POST(request: Request): Promise<NextResponse> {
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

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const locationId =
    typeof body.business_location_id === "string"
      ? body.business_location_id
      : "";
  const visible = typeof body.visible === "boolean" ? body.visible : null;
  if (!productId || !locationId || visible === null) {
    return NextResponse.json(
      {
        success: false,
        message: "product_id, business_location_id, and visible are required",
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

  const functionName = visible
    ? "show_product_at_location"
    : "hide_product_at_location";
  const { data, error } = await supabase.schema("mediasis").rpc(functionName, {
    p_business_location_id: locationId,
    p_product_id: productId,
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

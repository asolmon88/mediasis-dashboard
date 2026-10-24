import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type PreparationTimeRequestBody = {
  businessDeliveryMethodId?: string;
  businessLocationId?: string;
  preparationMinutes?: number;
};

const MAX_PREPARATION_MINUTES = 20;
const MAX_PREPARATION_MINUTES_MESSAGE =
  "No se permite configurar un tiempo de preparación mayor a 20 minutos.";

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
      { success: false, message: "No autorizado" },
      { status: 401 },
    );
  }

  let body: PreparationTimeRequestBody;
  try {
    body = (await request.json()) as PreparationTimeRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "El cuerpo de la solicitud no es válido." },
      { status: 400 },
    );
  }

  const businessDeliveryMethodId =
    typeof body.businessDeliveryMethodId === "string"
      ? body.businessDeliveryMethodId.trim()
      : "";
  const businessLocationId =
    typeof body.businessLocationId === "string"
      ? body.businessLocationId.trim()
      : "";
  const preparationMinutes = body.preparationMinutes;

  if (
    !businessDeliveryMethodId ||
    !businessLocationId ||
    typeof preparationMinutes !== "number" ||
    !Number.isInteger(preparationMinutes) ||
    preparationMinutes < 1
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "El tiempo de preparación debe ser un número entero de al menos 1 minuto.",
      },
      { status: 400 },
    );
  }

  if (preparationMinutes > MAX_PREPARATION_MINUTES) {
    return NextResponse.json(
      { success: false, message: MAX_PREPARATION_MINUTES_MESSAGE },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { success: false, message: "No se pudo configurar el servidor." },
      { status: 500 },
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

  const { error } = await supabase
    .schema("mediasis")
    .from("delivery_method_business_pickup_offset_location")
    .upsert(
      {
        business_delivery_method_id: businessDeliveryMethodId,
        business_location_id: businessLocationId,
        pickup_ready_offset: `${preparationMinutes} minutes`,
      },
      { onConflict: "business_delivery_method_id,business_location_id" },
    );

  if (error) {
    return NextResponse.json(
      {
        success: false,
        message: "No se pudo actualizar el tiempo de preparación.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, preparationMinutes });
}

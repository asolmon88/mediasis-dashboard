import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { clerkAuthenticationEnabledForRequest } from "@/lib/clerk/server-config";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";
import { requireStorefrontManagementAccess } from "@/lib/dashboard/storefront-authorization";

interface UploadTokenRequestBody {
  bucketName: string;
  path?: string;
  upsert?: boolean;
}

interface UploadTokenResponse {
  uploadToken: string;
  bucketName: string;
  path?: string;
  upsert: boolean;
  userId: string;
  expiresAt?: number;
}

interface ErrorResponse {
  error: string;
}

/**
 * Generate upload token for resumable uploads
 * This endpoint creates a session token that allows the client to upload files
 * directly to Supabase Storage using TUS protocol
 *
 * POST /api/storage/upload-token
 * Body: {
 *   bucketName: string,
 *   path?: string,
 *   upsert?: boolean
 * }
 */
export async function POST(request: Request): Promise<NextResponse<UploadTokenResponse | ErrorResponse>> {
  try {
    const body = await request.json() as UploadTokenRequestBody;
    const { bucketName, path, upsert = false } = body;
    const authorized = bucketName === "app_metadata"
      ? await requireStorefrontManagementAccess()
      : await requireFullProductsAccess();
    if (!authorized.success) {
      return NextResponse.json(
        { error: authorized.message },
        { status: 403 }
      );
    }

    if (!bucketName || !["products", "categories", "app_metadata"].includes(bucketName)) {
      return NextResponse.json(
        { error: "Bucket name is required" },
        { status: 400 }
      );
    }
    const requestedBusinessId = path?.split("/")[0] ?? "";
    let validPath = bucketName === "app_metadata"
      ? path === `${authorized.businessId}/logo` || path === `${authorized.businessId}/start-cards`
      : path === authorized.businessId;

    // Staff select businesses through an Mediasis cookie rather than Clerk
    // Organization membership. Older cookies were scoped to /admin and were
    // therefore absent on this /api request. Staff are allowed to manage every
    // active business, so validate the UUID embedded in the storage path
    // directly instead of silently falling back to a different business.
    if (authorized.context.mode === "staff" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBusinessId)) {
      const { data: requestedBusiness } = await authorized.admin
        .schema("mediasis")
        .from("businesses")
        .select("uid")
        .eq("uid", requestedBusinessId)
        .eq("active", true)
        .maybeSingle();
      validPath = Boolean(requestedBusiness) && (bucketName === "app_metadata"
        ? path === `${requestedBusinessId}/logo` || path === `${requestedBusinessId}/start-cards`
        : path === requestedBusinessId);
    }
    if (!validPath) {
      return NextResponse.json({ error: "Invalid upload path" }, { status: 403 });
    }

    const clerkSession = await clerkAuthenticationEnabledForRequest() ? await auth() : null;
    let uploadToken = clerkSession?.userId ? await clerkSession.getToken() : null;
    let expiresAt: number | undefined;
    if (!uploadToken) {
      const supabase = await createClient();
      const { data: { session } } = await supabase.auth.getSession();
      uploadToken = session?.access_token ?? null;
      expiresAt = session?.expires_at;
    }

    if (!uploadToken) {
      return NextResponse.json(
        { error: "No active session found" },
        { status: 401 }
      );
    }

    // Return the access token for upload authentication
    // The client will use this token to authenticate with Supabase Storage
    return NextResponse.json({
      uploadToken,
      bucketName,
      path,
      upsert,
      userId: authorized.context.appUserId ?? requestedBusinessId ?? authorized.businessId,
      expiresAt,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Mediasis storage upload token] failed", { message: errorMessage });
    return NextResponse.json(
      { error: "No se pudo autorizar la carga del archivo." },
      { status: 500 }
    );
  }
}

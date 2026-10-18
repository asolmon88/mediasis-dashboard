import { NextRequest, NextResponse } from "next/server";

import { requireMetaPixelManagementAccess } from "@/lib/dashboard/meta-pixel-authorization";
import { createSendingCredential, exchangeCode, metaFailureCategory, MetaConnectionError, unsealState } from "@/lib/meta-pixel-connection";

function redirect(request: NextRequest, result: string) {
  return NextResponse.redirect(new URL(`/admin/marketing/facebook-pixel?meta=${result}`, request.url));
}

export async function GET(request: NextRequest) {
  const failure = request.nextUrl.searchParams.get("error");
  const state = unsealState(request.cookies.get("mediasis_meta_oauth")?.value);
  if (failure || !state) {
    const result = !state ? "expired" : failure === "access_denied" ? "denied" : "oauth-failed";
    const response = redirect(request, result);
    response.cookies.delete("mediasis_meta_oauth");
    return response;
  }
  if (request.nextUrl.searchParams.get("state") !== state.nonce) { const result = redirect(request, "invalid-state"); result.cookies.delete("mediasis_meta_oauth"); return result; }

  const authorized = await requireMetaPixelManagementAccess();
  if (!authorized.success || authorized.businessId !== state.businessId || (authorized.context.appUserId ?? authorized.context.user.email) !== state.actorId) {
    const result = redirect(request, "forbidden"); result.cookies.delete("mediasis_meta_oauth"); return result;
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code) { const result = redirect(request, "denied"); result.cookies.delete("mediasis_meta_oauth"); return result; }

  try {
    const userToken = await exchangeCode(code);
    const credential = await createSendingCredential(userToken, state.pixelId);
    const stillAuthorized = await requireMetaPixelManagementAccess();
    if (!stillAuthorized.success || stillAuthorized.businessId !== state.businessId || (stillAuthorized.context.appUserId ?? stillAuthorized.context.user.email) !== state.actorId) {
      throw new MetaConnectionError("configuration", "La autorización cambió antes de guardar la conexión.");
    }
    const { error } = await stillAuthorized.admin.schema("mediasis").from("businesses").update({
      meta_pixel_id_orders: state.pixelId,
      meta_token_orders: credential.accessToken,
    }).eq("uid", stillAuthorized.businessId);
    if (error) throw new Error("No se pudo guardar la conexión.");
    const result = redirect(request, "connected"); result.cookies.delete("mediasis_meta_oauth"); return result;
  } catch (error) {
    const stage = error instanceof MetaConnectionError ? error.stage : "unknown";
    const details = error instanceof MetaConnectionError ? error.details : undefined;
    const category = metaFailureCategory(error);
    console.error("[meta-pixel] OAuth callback failed", {
      businessId: authorized.businessId,
      pixelId: state.pixelId,
      stage,
      category,
      metaCode: details?.code,
      metaSubcode: details?.subcode,
      metaTransient: details?.transient,
      metaTraceId: details?.traceId,
      message: error instanceof Error ? error.message : "unknown",
    });
    const result = redirect(request, `failed&reason=${category}`); result.cookies.delete("mediasis_meta_oauth"); return result;
  }
}

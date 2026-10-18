import { NextRequest, NextResponse } from "next/server";

import { requireMetaPixelManagementAccess } from "@/lib/dashboard/meta-pixel-authorization";
import { authorizationUrl, createState, metaConfigurationIssue, sealState, validatePixelId } from "@/lib/meta-pixel-connection";

export async function GET(request: NextRequest) {
  const authorized = await requireMetaPixelManagementAccess();
  if (!authorized.success) return NextResponse.redirect(new URL("/admin/marketing/facebook-pixel?meta=forbidden", request.url));
  const configurationIssue = metaConfigurationIssue();
  if (configurationIssue) {
    console.error("[meta-pixel] OAuth start blocked: configuration invalid", { configurationIssue });
    return NextResponse.redirect(new URL("/admin/marketing/facebook-pixel?meta=configuration", request.url));
  }
  try {
    const pixelId = validatePixelId(request.nextUrl.searchParams.get("pixel_id"));
    const state = createState(authorized.businessId, authorized.context.appUserId ?? authorized.context.user.email, pixelId);
    const response = NextResponse.redirect(authorizationUrl(state));
    response.cookies.set("mediasis_meta_oauth", sealState(state), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/meta/callback", maxAge: 10 * 60 });
    return response;
  } catch (error) {
    const result = error instanceof Error && error.message === "Ingresá un ID de pixel válido." ? "invalid-pixel" : "unavailable";
    console.error("[meta-pixel] OAuth start failed", { result, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.redirect(new URL(`/admin/marketing/facebook-pixel?meta=${result}`, request.url));
  }
}

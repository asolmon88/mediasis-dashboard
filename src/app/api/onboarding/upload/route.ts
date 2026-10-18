import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { requireGuidedOwner } from "@/lib/dashboard/guided-onboarding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session.userId) return NextResponse.json({ error: "Iniciá sesión." }, { status: 401 });
    const data = await request.formData();
    const businessId = data.get("businessId");
    const kind = data.get("kind");
    const file = data.get("file");
    if (typeof businessId !== "string" || !/^[0-9a-f-]{36}$/i.test(businessId)
      || (kind !== "logo" && kind !== "product") || !(file instanceof File)) {
      return NextResponse.json({ error: "Archivo inválido." }, { status: 400 });
    }
    const maxSize = kind === "product" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type)) || file.size > maxSize || file.size === 0) {
      return NextResponse.json({ error: `Subí una imagen JPG, PNG o WebP de hasta ${kind === "product" ? 10 : 5} MB.` }, { status: 400 });
    }
    const { admin } = await requireGuidedOwner(businessId);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const bucket = kind === "logo" ? "app_metadata" : "products";
    const path = kind === "logo" ? `${businessId}/logo/guided-${crypto.randomUUID()}.${extension}`
      : `${businessId}/guided-starter-${crypto.randomUUID()}.${extension}`;
    const { error } = await admin.storage.from(bucket).upload(path, await file.arrayBuffer(), {
      contentType: file.type, upsert: false, cacheControl: "3600",
    });
    if (error) throw error;
    const { data: url } = admin.storage.from(bucket).getPublicUrl(path);
    return NextResponse.json({ url: url.publicUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo subir la imagen." }, { status: 403 });
  }
}

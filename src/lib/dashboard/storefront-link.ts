import "server-only";

import { requireStorefrontManagementAccess } from "@/lib/dashboard/storefront-authorization";

export type PreferredStorefrontLink = {
  url: string;
  kind: "custom_domain" | "mediasis_link";
};

/**
 * Returns the only public storefront URL the dashboard should share. A
 * merchant-owned domain wins; the Mediasis slug remains the fallback and is
 * deliberately not removed from the public router.
 */
export async function getAuthorizedPreferredStorefrontLink() {
  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return authorized;

  const [customDomainResult, slugResult] = await Promise.all([
    authorized.admin.schema("mediasis").from("business_domain")
      .select("domain")
      .eq("business_uid", authorized.businessId)
      .eq("type", "order_app")
      .eq("is_internal_storefront", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    authorized.admin.schema("mediasis").from("business_domain")
      .select("base_domain_slug")
      .eq("business_uid", authorized.businessId)
      .eq("type", "order_app")
      .eq("is_internal_storefront", true)
      .maybeSingle(),
  ]);

  if (customDomainResult.error) {
    throw new Error(`No se pudo leer el dominio de la app: ${customDomainResult.error.message}`);
  }
  if (slugResult.error) {
    throw new Error(`No se pudo leer el link de Mediasis: ${slugResult.error.message}`);
  }

  const customDomain = customDomainResult.data?.domain?.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const slug = slugResult.data?.base_domain_slug?.trim().toLowerCase();
  const storefrontLink: PreferredStorefrontLink | null = customDomain
    ? { url: `https://${customDomain}`, kind: "custom_domain" }
    : slug
      ? { url: `https://www.mediasis.cr/${encodeURIComponent(slug)}`, kind: "mediasis_link" }
      : null;

  return { ...authorized, storefrontLink };
}

import "server-only";

const PRODUCTION_ORDER_APP_BASE_URL = "https://app.mediasis.cr";

export function getOrderAppBaseUrl() {
  const configured = process.env.ORDER_APP_BASE_URL?.trim() || PRODUCTION_ORDER_APP_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(configured)
    ? configured
    : `${/^(localhost|127\.0\.0\.1)(?::|$)/i.test(configured) ? "http" : "https"}://${configured}`;

  return withProtocol.replace(/\/+$/, "");
}

export function getOrderAppStorefrontUrl(slug: string) {
  return `${getOrderAppBaseUrl()}/${encodeURIComponent(slug.trim().toLowerCase())}`;
}

import type { NextConfig } from "next";

const imageRemotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "https",
    hostname: "picsum.photos",
  },
  {
    protocol: "https",
    hostname: "**.supabase.co",
  },
  {
    protocol: "https",
    hostname: "server.mediasis.cr",
  },
];

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (configuredSupabaseUrl) {
  const supabaseUrl = new URL(configuredSupabaseUrl);
  if (supabaseUrl.hostname === "127.0.0.1" || supabaseUrl.hostname === "localhost") {
    imageRemotePatterns.push({
      protocol: supabaseUrl.protocol.slice(0, -1) as "http" | "https",
      hostname: supabaseUrl.hostname,
      port: supabaseUrl.port,
      pathname: "/storage/v1/object/public/**",
    });
  }
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "sharp"],
  outputFileTracingIncludes: {
    "/api/orders/receipt-print-bytes": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    "/api/internal/orders/receipt-print-bytes": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
  images: {
    remotePatterns: imageRemotePatterns,
  },
};

export default nextConfig;

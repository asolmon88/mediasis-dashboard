"use client";

import Script from "next/script";

declare global {
  interface Window {
    chatwootSettings?: { position: "right"; type: "expanded_bubble"; launcherTitle: string };
    chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void };
  }
}

const baseUrl = "https://app.chatwoot.com";
const websiteToken = "tUSC4tkLQjhQuy2U7Dw6xk9Z";

export function ChatwootSupport() {
  return (
    <>
      <Script id="chatwoot-settings" strategy="afterInteractive">
        {`window.chatwootSettings = { position: "right", type: "expanded_bubble", launcherTitle: "" };`}
      </Script>
      <Script
        id="chatwoot-sdk"
        src={`${baseUrl}/packs/js/sdk.js`}
        strategy="afterInteractive"
        onLoad={() => window.chatwootSDK?.run({ websiteToken, baseUrl })}
      />
    </>
  );
}

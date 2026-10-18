"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, type ReactNode } from "react";

import { dashboardClerkClientEnabled } from "@/lib/clerk/config";

type DashboardClerkTokenGetter = () => Promise<string | null>;

let dashboardTokenRequestSequence = 0;

const DashboardClerkTokenContext = createContext<DashboardClerkTokenGetter | null>(null);

function DashboardClerkTokenBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const getDashboardToken = useCallback(async () => {
    const requestId = `clerk-token-${Date.now()}-${++dashboardTokenRequestSequence}`;
    console.info(
      `[Mediasis dashboard auth] ${JSON.stringify({ requestId, stage: "token-requested" })}`,
    );
    try {
      const token = await getToken();
      let expiresAt: number | null = null;
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as { exp?: number };
          expiresAt = typeof payload.exp === "number" ? payload.exp : null;
        } catch {
          // A malformed token will still be rejected by Supabase. We only avoid
          // decoding failures interfering with the diagnostic trail here.
        }
      }
      console.info(`[Mediasis dashboard auth] ${JSON.stringify({
        requestId,
        stage: "token-resolved",
        tokenPresent: Boolean(token),
        expiresAt,
      })}`);
      return token;
    } catch (error) {
      console.error(`[Mediasis dashboard auth] ${JSON.stringify({
        requestId,
        stage: "token-failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      })}`);
      throw error;
    }
  }, [getToken]);

  return (
    <DashboardClerkTokenContext.Provider value={getDashboardToken}>
      {children}
    </DashboardClerkTokenContext.Provider>
  );
}

export function useDashboardClerkToken() {
  return useContext(DashboardClerkTokenContext);
}

export function DashboardClerkProvider({ children }: { children: ReactNode }) {
  if (!dashboardClerkClientEnabled()) {
    return (
      <DashboardClerkTokenContext.Provider value={null}>
        {children}
      </DashboardClerkTokenContext.Provider>
    );
  }
  return (
    <ClerkProvider
      signInUrl="/clerk-auth/sign-in"
      signUpUrl="/clerk-auth/get-started"
      afterSignOutUrl="/clerk-auth/sign-in"
    >
      <DashboardClerkTokenBridge>{children}</DashboardClerkTokenBridge>
    </ClerkProvider>
  );
}

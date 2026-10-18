"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { DashboardAuthorizationContext } from "@/lib/dashboard/auth-types";

const DashboardAuthContext = createContext<DashboardAuthorizationContext | null>(null);

export function DashboardAuthProvider({
  value,
  children,
}: {
  value: DashboardAuthorizationContext;
  children: ReactNode;
}) {
  return <DashboardAuthContext.Provider value={value}>{children}</DashboardAuthContext.Provider>;
}

export function useDashboardAuthorization() {
  const context = useContext(DashboardAuthContext);
  if (!context) throw new Error("Dashboard authorization context is unavailable.");
  return context;
}

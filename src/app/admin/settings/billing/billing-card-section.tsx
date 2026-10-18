"use client";

import { OnvoCardManager } from "./onvo-card-manager";

export function BillingCardSection({ canManage, billingEmail, storedCard }: {
  canManage: boolean;
  billingEmail: string;
  storedCard?: { brand: string | null; label: string | null; last4: string | null } | null;
}) {
  return <OnvoCardManager canManage={canManage} billingEmail={billingEmail} storedCard={storedCard} />;
}

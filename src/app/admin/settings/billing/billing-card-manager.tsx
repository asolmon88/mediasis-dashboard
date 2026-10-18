"use client";

// Compatibility surface for older dashboard screens while they use the Onvo
// component. It intentionally contains no processor SDK, token, or redirect.
import { OnvoCardManager } from "./onvo-card-manager";

export type TilopayCard = { id: string; name?: string; brand?: string };
type LegacyProps = {
  canManage: boolean; billingEmail: string; storedCard?: { brand: string | null; label: string | null; last4?: string | null } | null;
  // Deprecated callers are migrated separately; accepting these fields keeps
  // the component boundary stable without ever calling the legacy processor.
  currency?: string; requireRecurringConsent?: boolean; consentDescription?: string;
  createSession?: () => Promise<unknown>; recordTokenizationConsent?: (sessionId: string, cardLabel: string) => Promise<unknown>;
  onCardSelected?: (card: TilopayCard) => Promise<unknown>;
};
export function BillingCardManager({ canManage, billingEmail, storedCard }: LegacyProps) {
  return <OnvoCardManager canManage={canManage} billingEmail={billingEmail} storedCard={storedCard ? { ...storedCard, last4: storedCard.last4 ?? null } : null} />;
}

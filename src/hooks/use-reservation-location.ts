"use client";

import { useEffect, useMemo } from "react";

import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
import { useActiveLocationId, useLocationStore } from "@/stores/location-store";

export function useReservationLocation() {
  const authorization = useDashboardAuthorization();
  const activeLocationId = useActiveLocationId();
  const selectLocation = useLocationStore((state) => state.selectLocation);
  const eligibleIds = authorization.reservationLocationIds;
  const effectiveLocationId = activeLocationId && eligibleIds.includes(activeLocationId)
    ? activeLocationId
    : eligibleIds[0] ?? null;

  useEffect(() => {
    if (effectiveLocationId && activeLocationId !== effectiveLocationId) {
      selectLocation(effectiveLocationId);
    }
  }, [activeLocationId, effectiveLocationId, selectLocation]);

  return useMemo(() => ({
    activeLocationId: effectiveLocationId,
    eligibleLocationIds: eligibleIds,
    hasEligibleLocations: eligibleIds.length > 0,
  }), [effectiveLocationId, eligibleIds]);
}

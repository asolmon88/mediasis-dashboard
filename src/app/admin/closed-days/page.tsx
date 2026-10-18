"use client"

import ClosedDaysPageLayout from "@/components/locations/ClosedDaysPageLayout";
import { UIClosedSpecialDay } from "@/lib/FormSchemas/closedSpecialDaySchema";
import { deserializeClosedSpecialDay } from "@/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getReservationClosedDays } from "./actions";
import { useReservationLocation } from "@/hooks/use-reservation-location";

export default function ClosedDaysPage() {
  const { activeLocationId } = useReservationLocation();
  const [loadingClosedSpecialDays, setLoadingClosedSpecialDays] = useState<boolean>(false);
  const [closedSpecialDays, setClosedSpecialDays] = useState<UIClosedSpecialDay[]>([])
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function getCurrentClosedSpecialDays() {
      setLoadingClosedSpecialDays(true);
      setClosedSpecialDays([]);
      if (!activeLocationId) {
        setLoadingClosedSpecialDays(false);
        return;
      }
      const result = await getReservationClosedDays(activeLocationId);
      if (ignore) return;
      if (!result.success) {
        toast.error(`ERROR: ${result.message}. Por favor recargue la página.`);
        setLoadingClosedSpecialDays(false);
        return;
      }
      const normalized: UIClosedSpecialDay[] = (result.rows ?? []).map(deserializeClosedSpecialDay)
      setClosedSpecialDays(normalized)
      setLoadingClosedSpecialDays(false);
    }
    void getCurrentClosedSpecialDays();
    return () => {
      ignore = true;
    };
  }, [activeLocationId, refreshVersion])
  

  return (
    <ClosedDaysPageLayout
      loadingClosedSpecialDays={loadingClosedSpecialDays}
      currentClosedSpecialDays={closedSpecialDays}
      onChanged={() => setRefreshVersion((version) => version + 1)}
    />
  );
}

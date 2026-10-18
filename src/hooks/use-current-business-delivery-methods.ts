import React, { useEffect } from "react";
import { toast } from "sonner";

import { getProductDeliveryMethodOptions } from "@/app/admin/products/actions";
import { SelectOption } from "@/lib/types/dashboardTypes";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type Params = {
  setDeliveryMethodOptions: Setter<SelectOption[]>;
  setDeliveryMethodsLoading: Setter<boolean>;
};

export function useCurrentBusinessDeliveryMethods({
  setDeliveryMethodOptions,
  setDeliveryMethodsLoading,
}: Params) {
  useEffect(() => {
    let ignore = false;
    async function loadDeliveryMethods() {
      setDeliveryMethodsLoading(true);
      try {
        const result = await getProductDeliveryMethodOptions();
        if (!result.success) throw new Error(result.message);
        if (ignore) return;
        type DeliveryMethodRow = { uid: string | null; name: string | null };
        const mapped =
          (result.data ?? [])
            .map((row: DeliveryMethodRow): SelectOption | null => {
              const trimmed = row.name?.trim() ?? "";
              if (!row.uid || !trimmed.length) {
                return null;
              }
              return {
                value: row.uid,
                label: trimmed,
              };
            })
            .filter(
              (item: SelectOption | null): item is SelectOption =>
                Boolean(item),
            );
        setDeliveryMethodOptions(mapped);
      } catch (error) {
        if (!ignore) {
          console.error(error);
          toast.error("No se pudieron cargar los métodos de delivery");
        }
      } finally {
        if (!ignore) {
          setDeliveryMethodsLoading(false);
        }
      }
    }
    loadDeliveryMethods();
    return () => {
      ignore = true;
    };
  }, [setDeliveryMethodOptions, setDeliveryMethodsLoading]);
}

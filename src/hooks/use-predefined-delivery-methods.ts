import { useEffect, useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { SelectOption } from "@/lib/types/dashboardTypes";

export function usePredefinedDeliveryMethods() {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function loadDeliveryMethods() {
      setLoading(true);
      try {
        const supabase = await createClient();
        const { data, error } = await supabase
          .schema("mediasis")
          .from("delivery_methods")
          .select("id, name")
          .order("name");

        if (error) throw error;
        if (ignore) return;

        type Row = { id: string | null; name: string | null };
        const mapped =
          (data ?? [])
            .map((row: Row): SelectOption | null => {
              const id = row.id ?? "";
              const name = (row.name ?? "").trim();
              if (!id || !name) return null;
              return { value: id, label: name };
            })
            .filter((item: SelectOption | null): item is SelectOption => Boolean(item));

        setOptions(mapped);
      } catch (error) {
        if (!ignore) {
          console.error(error);
          toast.error("No se pudieron cargar los métodos de delivery.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadDeliveryMethods();
    return () => {
      ignore = true;
    };
  }, []);

  return { options, loading };
}

import React, { useEffect } from "react";
import { toast } from "sonner";

import { getStartCardCategories } from "@/app/admin/app/actions";
import { SelectOption } from "@/lib/types/dashboardTypes";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type Params = {
  setCategoryOptions: Setter<SelectOption[]>;
  setCategoriesLoading: Setter<boolean>;
};

export function useCurrentBusinessCategories({
  setCategoryOptions,
  setCategoriesLoading,
}: Params) {
  useEffect(() => {
    let ignore = false;
    async function loadCategories() {
      setCategoriesLoading(true);
      try {
        const result = await getStartCardCategories();
        if (!result.success) throw new Error(result.message);
        const data = result.data;
        if (ignore) return;
        type CategoryRow = { product_category_id: string | null; name: string | null };
        const mapped =
          (data ?? [])
            .map((row: CategoryRow): SelectOption | null => {
              const trimmed = row.name?.trim() ?? "";
              if (!row.product_category_id || !trimmed.length) {
                return null;
              }
              return {
                value: row.product_category_id,
                label: trimmed,
              };
            })
            .filter(
              (item: SelectOption | null): item is SelectOption =>
                Boolean(item),
            );
        setCategoryOptions(mapped);
      } catch (error) {
        if (!ignore) {
          console.error(error);
          toast.error("No se pudieron cargar las categorías");
        }
      } finally {
        if (!ignore) {
          setCategoriesLoading(false);
        }
      }
    }
    loadCategories();
    return () => {
      ignore = true;
    };
  }, [setCategoryOptions, setCategoriesLoading]);
}

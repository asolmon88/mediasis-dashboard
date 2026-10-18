import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDashboardSupabase } from "@/hooks/use-dashboard-supabase";

type PaymentMethod = {
  uid: string;
  name: string;
};

type PaymentMethodsResponse = {
  success: boolean;
  data?: PaymentMethod[];
  message?: string;
};

export const usePaymentMethods = (businessLocationId?: string | null) => {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useDashboardSupabase();

  useEffect(() => {
    let isMounted = true;

    const fetchMethods = async () => {
      setLoading(true);
      if (!businessLocationId) {
        setMethods([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.schema("mediasis").rpc(
        "get_visible_payment_methods",
        {
          p_business_location_id: businessLocationId,
        }
      );

      if (!isMounted) return;

      if (error) {
        toast.error("No se pudieron cargar los metodos de pago");
        setLoading(false);
        return;
      }

      const response = data as PaymentMethodsResponse | null;
      if (!response?.success) {
        toast.error(response?.message ?? "No se pudieron cargar los metodos de pago");
        setMethods([]);
        setLoading(false);
        return;
      }
      setMethods(
        (response.data ?? []).map((item) => ({ uid: item.uid, name: item.name }))
      );
      setLoading(false);
    };

    fetchMethods();

    return () => {
      isMounted = false;
    };
  }, [businessLocationId, supabase]);

  return { methods, loading };
};

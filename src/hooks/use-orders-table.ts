import { useEffect, useMemo, useState } from "react";
import { useDashboardSupabase } from "@/hooks/use-dashboard-supabase";
import { OrdersTableResponse, OrdersTableRow } from "@/lib/types/dashboardTypes";
import { toast } from "sonner";

let ordersRequestSequence = 0;

function logOrdersFlow(
  requestId: string,
  stage: string,
  details: Record<string, unknown> = {},
) {
  // Intentionally safe for production diagnostics: never include JWTs, customer
  // data, or complete RPC payloads. The request ID lets us distinguish a stale
  // React effect from the request whose rows are currently visible.
  console.info(`[Mediasis orders flow] ${JSON.stringify({ requestId, stage, ...details })}`);
}

type UseOrdersTableParams = {
  businessLocationId?: string | null;
  limit?: number;
  offset?: number;
  search?: string;
  paymentStatusKey?: string;
  orderStatusKey?: string;
  paymentMethodKey?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  sortBy?: "created_at" | "total";
  sortDirection?: "asc" | "desc";
};

export const useOrdersTable = ({
  businessLocationId,
  limit = 50,
  offset = 0,
  search = "",
  paymentStatusKey = "",
  orderStatusKey = "",
  paymentMethodKey = "",
  dateFrom = null,
  dateTo = null,
  sortBy = "created_at",
  sortDirection = "desc",
}: UseOrdersTableParams) => {
  const [rows, setRows] = useState<OrdersTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const supabase = useDashboardSupabase();

  useEffect(() => {
    let isCurrentRequest = true;
    const requestId = `orders-${Date.now()}-${++ordersRequestSequence}`;

    const fetchOrders = async () => {
      logOrdersFlow(requestId, "started", {
        businessLocationId: businessLocationId ?? null,
        authorizationClientReady: Boolean(supabase),
      });
      setLoading(true);
      setRows([]);
      setHasMore(false);
      if (!businessLocationId) {
        // The dashboard authorization/location context hydrates after the first
        // client render. A null location at this point is an expected loading
        // state, not an authorization failure. The effect runs again as soon as
        // the permitted active location becomes available.
        logOrdersFlow(requestId, "waiting-for-location");
        setLoading(false);
        return;
      }

      const paymentStatus = paymentStatusKey
        ? (paymentStatusKey.split(",") as Array<"paid" | "pending">)
        : (["paid"] as Array<"paid" | "pending">);
      const orderStatus = orderStatusKey ? orderStatusKey.split(",") : null;
      const paymentMethod = paymentMethodKey ? paymentMethodKey.split(",") : null;

      const { data, error } = await supabase.schema("mediasis").rpc("get_orders_table", {
        p_business_location_id: businessLocationId,
        p_limit: limit,
        p_offset: offset,
        p_payment_status: paymentStatus,
        p_order_status: orderStatus,
        p_payment_method: paymentMethod,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_sort_by: sortBy,
        p_sort_direction: sortDirection,
      });

      // React can start a replacement request when the selected location or the
      // authenticated Supabase client changes. A superseded request must never
      // update state or show an authentication toast after the newer request has
      // already succeeded.
      if (!isCurrentRequest) {
        logOrdersFlow(requestId, "stale-result-ignored", {
          result: error ? "error" : "response",
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
        });
        return;
      }

      if (error) {
        console.error(`[Mediasis orders flow] ${JSON.stringify({
          requestId,
          stage: "rpc-error",
          errorCode: error.code ?? null,
          errorMessage: error.message,
          errorDetails: error.details ?? null,
          errorHint: error.hint ?? null,
        })}`);
        toast.error(error.message);
        setLoading(false);
        return;
      }

      const response = data as OrdersTableResponse | null;
      if (!response?.success || !response.data) {
        console.error(`[Mediasis orders flow] ${JSON.stringify({
          requestId,
          stage: "rpc-rejected",
          responseSuccess: response?.success ?? null,
          responseMessage: response?.message ?? null,
        })}`);
        toast.error(response?.message ?? "Error al cargar pedidos");
        setLoading(false);
        return;
      }

      logOrdersFlow(requestId, "succeeded", {
        rowCount: response.data.rows.length,
        hasMore: response.data.pagination.has_more,
      });
      setRows(response.data.rows);
      setHasMore(response.data.pagination.has_more);
      setLoading(false);
    };

    fetchOrders();

    return () => {
      isCurrentRequest = false;
      logOrdersFlow(requestId, "superseded-or-unmounted");
    };
  }, [
    businessLocationId,
    limit,
    offset,
    paymentStatusKey,
    orderStatusKey,
    paymentMethodKey,
    dateFrom,
    dateTo,
    sortBy,
    sortDirection,
    supabase,
  ]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const byOrder = row.order_id.toLowerCase().includes(query);
      const byCustomer = row.customer_name.toLowerCase().includes(query);
      return byOrder || byCustomer;
    });
  }, [rows, search]);

  return {
    rows: filteredRows,
    loading,
    hasMore,
    limit,
    offset,
  };
};

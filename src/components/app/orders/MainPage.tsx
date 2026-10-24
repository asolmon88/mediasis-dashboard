"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useOrdersTable } from "@/hooks/use-orders-table";
import { OrdersTable } from "./OrdersTable";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OrdersFiltersSheet } from "./OrdersFiltersSheet";
import { OrdersTableRow } from "@/lib/types/dashboardTypes";
import { toast } from "sonner";
import { useActiveLocationId } from "@/stores/location-store";
import { useDashboardSupabase } from "@/hooks/use-dashboard-supabase";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
import { marketDayBoundaryUtcIso, marketDayInclusiveEndUtcIso } from "@/lib/dashboard/market";

type EditableOrderStatus =
  | "pending"
  | "preparing"
  | "ready_for_pickup"
  | "on_the_way"
  | "delivered"
  | "cancelled";

export default function MainPage() {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const supabase = useDashboardSupabase();
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rowsState, setRowsState] = useState<OrdersTableRow[]>([]);
  const [savingByOrderId, setSavingByOrderId] = useState<Record<string, boolean>>({});
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const businessLocationId = useActiveLocationId();
  const previousLocationIdRef = useRef<string | null>(null);

  const limit = useMemo(() => {
    const raw = Number(searchParams.get("limit") ?? 50);
    return Number.isFinite(raw) && raw > 0 ? raw : 50;
  }, [searchParams]);

  const page = useMemo(() => {
    const raw = Number(searchParams.get("page") ?? 1);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }, [searchParams]);

  const offset = useMemo(() => (page - 1) * limit, [page, limit]);

  const paymentParam = searchParams.get("payment_status") ?? "";
  const paymentSelections = paymentParam ? paymentParam.split(",") : [];

  const sortBy = (searchParams.get("sort_by") ?? "created_at") as
    | "created_at"
    | "total";
  const sortDirection = (searchParams.get("sort_direction") ?? "desc") as "asc" | "desc";

  const orderStatusParam = searchParams.get("order_status") ?? "";
  const orderStatusSelections = orderStatusParam ? orderStatusParam.split(",") : [];
  const paymentMethodParam = searchParams.get("payment_method") ?? "";
  const paymentMethodSelections = paymentMethodParam ? paymentMethodParam.split(",") : [];
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";

  const dateToIso = dateTo ? marketDayInclusiveEndUtcIso(dateTo, market.timezone) : null;
  const dateFromIso = dateFrom ? marketDayBoundaryUtcIso(dateFrom, market.timezone) : null;

  const { rows, loading, hasMore } = useOrdersTable({
    businessLocationId,
    search,
    limit,
    offset,
    paymentStatusKey: paymentParam,
    orderStatusKey: orderStatusParam,
    paymentMethodKey: paymentMethodParam,
    dateFrom: dateFromIso,
    dateTo: dateToIso,
    sortBy,
    sortDirection,
  });

  useEffect(() => {
    setRowsState(rows);
  }, [rows]);

  useEffect(() => {
    const previousLocationId = previousLocationIdRef.current;
    previousLocationIdRef.current = businessLocationId;
    if (!previousLocationId || previousLocationId === businessLocationId || page === 1) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  }, [businessLocationId, page, pathname, router, searchParams]);

  const handleChangeRowStatus = async (
    orderId: string,
    currentStatus: string,
    nextStatus: EditableOrderStatus
  ) => {
    if (currentStatus === nextStatus || savingByOrderId[orderId]) return;

    setRowsState((prev) =>
      prev.map((row) =>
        row.order_id === orderId ? { ...row, order_status: nextStatus } : row
      )
    );
    setSavingByOrderId((prev) => ({ ...prev, [orderId]: true }));

    try {
      // This client carries either the existing Supabase session or the Clerk
      // JWT. PostgreSQL remains authoritative: the orders UPDATE policy checks
      // orders.manage.full and the member's location scope for Clerk users,
      // while preserving the legacy owner path.
      const { error } = await supabase
        .schema("mediasis")
        .from("orders")
        .update({ order_status: nextStatus })
        .eq("order_id", orderId);
      if (error) throw error;
    } catch (error) {
      setRowsState((prev) =>
        prev.map((row) =>
          row.order_id === orderId ? { ...row, order_status: currentStatus } : row
        )
      );
      toast.error("No se pudo actualizar el estado de la orden.");
    } finally {
      setSavingByOrderId((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const updatePage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    params.set("limit", String(limit));
    router.replace(`${pathname}?${params.toString()}`);
  };

  const updatePaymentFilter = (nextFilter: "all" | "paid" | "pending") => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFilter === "all") {
      params.delete("payment_status");
    } else {
      params.set("payment_status", nextFilter);
    }
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const updateSort = (nextSortBy: "created_at" | "total", nextDirection: "asc" | "desc") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort_by", nextSortBy);
    params.set("sort_direction", nextDirection);
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const toggleParamValue = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const raw = params.get(key);
    const values = raw ? raw.split(",") : [];
    const nextValues = values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
    if (nextValues.length === 0) {
      params.delete(key);
    } else {
      params.set(key, nextValues.join(","));
    }
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const updateDateParam = (key: "date_from" | "date_to", value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("order_status");
    params.delete("payment_status");
    params.delete("payment_method");
    params.delete("date_from");
    params.delete("date_to");
    params.set("page", "1");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="px-4 py-3 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ordenes</h1>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por orden o cliente"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={paymentSelections.length === 0 ? "secondary" : "ghost"}
            onClick={() => updatePaymentFilter("all")}
          >
            Todas
          </Button>
          <Button
            size="sm"
            variant={paymentSelections.includes("pending") ? "secondary" : "ghost"}
            onClick={() => updatePaymentFilter("pending")}
          >
            Rechazada
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              type="button"
              onClick={() => setFiltersOpen(true)}
            >
              <Filter className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" type="button">
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sortBy}
                  onValueChange={(value) =>
                    updateSort(value as "created_at" | "total", sortDirection)
                  }
                >
                  <DropdownMenuRadioItem value="created_at">
                    Fecha
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="total">
                    Total
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Orden</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sortDirection}
                  onValueChange={(value) =>
                    updateSort(sortBy, value as "asc" | "desc")
                  }
                >
                  <DropdownMenuRadioItem value="asc">
                    Primero lo mas antiguo
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="desc">
                    Primero lo mas reciente
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <OrdersTable
        rows={rowsState}
        loading={loading}
        offset={offset}
        savingByOrderId={savingByOrderId}
        onChangeRowStatus={handleChangeRowStatus}
      />

      <OrdersFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        businessLocationId={businessLocationId}
        orderStatus={orderStatusSelections}
        paymentStatus={paymentSelections}
        paymentMethods={paymentMethodSelections}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onToggleOrderStatus={(value) => toggleParamValue("order_status", value)}
        onTogglePaymentStatus={(value) => toggleParamValue("payment_status", value)}
        onTogglePaymentMethod={(value) => toggleParamValue("payment_method", value)}
        onChangeDateFrom={(value) => updateDateParam("date_from", value)}
        onChangeDateTo={(value) => updateDateParam("date_to", value)}
        onClearAll={clearFilters}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Pagina {page}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => updatePage(page - 1)}
            disabled={page <= 1 || loading}
          >
            Anterior
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => updatePage(page + 1)}
            disabled={!hasMore || loading}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  );
}

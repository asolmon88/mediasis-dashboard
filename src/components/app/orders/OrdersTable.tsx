"use client";

import { OrdersTableRow } from "@/lib/types/dashboardTypes";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { normalizeExternalUrl } from "@/lib/utils";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
import { mapOrderStatusToSpanish } from "@/lib/orders/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronDown, ReceiptText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type OrdersTableProps = {
  rows: OrdersTableRow[];
  loading: boolean;
  offset: number;
  savingByOrderId: Record<string, boolean>;
  onChangeRowStatus: (
    orderId: string,
    currentStatus: string,
    nextStatus: EditableOrderStatus
  ) => void;
};

type EditableOrderStatus =
  | "pending"
  | "preparing"
  | "ready_for_pickup"
  | "on_the_way"
  | "delivered"
  | "cancelled";

const formatDate = (value: string, locale: string, timeZone: string) =>
  new Date(value).toLocaleString(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const statusVariant = (status: string) => {
  if (status === "delivered") return "secondary";
  return "outline";
};

const mapPaymentStatusToSpanish = (status: string) => {
  if (status === "paid") return "Pagada";
  if (status === "pending") return "Rechazada";
  if (status === "refunded") return "Reembolsada";
  return status;
};

const paymentStatusClassName = (status: string) => {
  if (status === "paid") return "uppercase border-green-500 text-green-600";
  if (status === "refunded") return "uppercase border-blue-500 text-blue-600";
  return "uppercase border-red-500 text-red-600";
};

const normalizeTableStatus = (status: string) => (status === "new" ? "pending" : status);

const getStatusOptions = (row: OrdersTableRow): EditableOrderStatus[] => {
  const fulfillmentStatus: EditableOrderStatus =
    row.delivery_require_location && !row.delivery_require_courier
      ? "on_the_way"
      : "ready_for_pickup";
  const statuses: EditableOrderStatus[] = [
    "pending",
    "preparing",
    fulfillmentStatus,
    "delivered",
  ];

  return row.payment_managed_by_business ? [...statuses, "cancelled"] : statuses;
};

const StatusEditor = ({
  row,
  disabled,
  onChangeRowStatus,
}: {
  row: OrdersTableRow;
  disabled: boolean;
  onChangeRowStatus: (
    orderId: string,
    currentStatus: string,
    nextStatus: EditableOrderStatus
  ) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        disabled={disabled}
        className="w-full px-0 py-0 text-left hover:bg-transparent disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span className="inline-flex items-center gap-1.5">
          <Badge
            variant={statusVariant(normalizeTableStatus(row.order_status))}
            className="uppercase"
          >
            {mapOrderStatusToSpanish(normalizeTableStatus(row.order_status))}
          </Badge>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-44">
      {getStatusOptions(row).map((status) => (
        <DropdownMenuItem
          key={status}
          onSelect={() => onChangeRowStatus(row.order_id, row.order_status, status)}
          className="uppercase"
        >
          {mapOrderStatusToSpanish(status)}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export const OrdersTable = ({
  rows,
  loading,
  savingByOrderId,
  onChangeRowStatus,
}: OrdersTableProps) => {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const formatCurrency = (value: number | null | undefined) => value == null ? "-" : new Intl.NumberFormat(market.locale, {
    style: "currency", currency: market.currencyCode,
  }).format(value);
  const safeRows = rows ?? [];
  return (
    <div className="space-y-3">
      <div className="hidden md:block rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Orden</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Recibo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead>Creada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Cargando pedidos...
                </TableCell>
              </TableRow>
            ) : safeRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No hay pedidos para mostrar
                </TableCell>
              </TableRow>
            ) : (
              safeRows.map((row) => {
                const receiptUrl = normalizeExternalUrl(row.receipt_url);
                return (
                <TableRow key={row.order_id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/orders/${row.order_id}`}
                      className="text-blue-600 hover:underline"
                    >
                      #{row.human_order_number}
                    </Link>
                  </TableCell>
                  <TableCell>{row.customer_name}</TableCell>
                  <TableCell>{formatCurrency(row.total)}</TableCell>
                  <TableCell>
                    {receiptUrl ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={receiptUrl} target="_blank" rel="noreferrer">
                          <ReceiptText className="h-4 w-4" />
                          Ver recibo
                        </a>
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusEditor
                      row={row}
                      disabled={Boolean(savingByOrderId[row.order_id])}
                      onChangeRowStatus={onChangeRowStatus}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={paymentStatusClassName(row.payment_status)}
                    >
                      {mapPaymentStatusToSpanish(row.payment_status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(row.created_at, market.locale, market.timezone)}</TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground">
            Cargando pedidos...
          </div>
        ) : safeRows.length === 0 ? (
          <div className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground">
            No hay pedidos para mostrar
          </div>
        ) : (
          safeRows.map((row) => {
            const receiptUrl = normalizeExternalUrl(row.receipt_url);
            return (
            <div key={row.order_id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/orders/${row.order_id}`}
                  className="text-blue-600 hover:underline font-semibold text-sm"
                >
                  #{row.human_order_number}
                </Link>
                <span className="font-semibold text-sm">{row.customer_name}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatCurrency(row.total)} · {formatDate(row.created_at, market.locale, market.timezone)}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <div className="min-w-[150px]">
                  <StatusEditor
                    row={row}
                    disabled={Boolean(savingByOrderId[row.order_id])}
                    onChangeRowStatus={onChangeRowStatus}
                  />
                </div>
                <Badge
                  variant="outline"
                  className={paymentStatusClassName(row.payment_status)}
                >
                  {mapPaymentStatusToSpanish(row.payment_status)}
                </Badge>
              </div>
              {receiptUrl ? (
                <Button asChild size="sm" variant="outline" className="mt-3 w-full">
                  <a href={receiptUrl} target="_blank" rel="noreferrer">
                    <ReceiptText className="h-4 w-4" />
                    Ver recibo
                  </a>
                </Button>
              ) : null}
            </div>
          )})
        )}
      </div>
    </div>
  );
};

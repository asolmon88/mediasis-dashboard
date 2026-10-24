"use client";

import { useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { mapOrderStatusToSpanish } from "@/lib/orders/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

type OrdersFiltersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessLocationId?: string | null;
  orderStatus: string[];
  paymentStatus: string[];
  paymentMethods: string[];
  dateFrom: string;
  dateTo: string;
  onToggleOrderStatus: (status: string) => void;
  onTogglePaymentStatus: (status: string) => void;
  onTogglePaymentMethod: (methodId: string) => void;
  onChangeDateFrom: (value: string) => void;
  onChangeDateTo: (value: string) => void;
  onClearAll: () => void;
};

const ORDER_STATUS_OPTIONS = [
  "pending",
  "new",
  "preparing",
  "ready_for_pickup",
  "on_the_way",
  "ready",
  "accepted",
  "delivered",
  "cancelled",
];

const parseYMDLocal = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

export function OrdersFiltersSheet({
  open,
  onOpenChange,
  businessLocationId,
  orderStatus,
  paymentStatus,
  paymentMethods,
  dateFrom,
  dateTo,
  onToggleOrderStatus,
  onTogglePaymentStatus,
  onTogglePaymentMethod,
  onChangeDateFrom,
  onChangeDateTo,
  onClearAll,
}: OrdersFiltersSheetProps) {
  const { methods } = usePaymentMethods(businessLocationId);
  const safeMethods = methods ?? [];

  const paymentOptions = useMemo(
    () => [
      { value: "pending", label: "Rechazada" },
      { value: "paid", label: "Pagada" },
    ],
    []
  );

  const fromDate = useMemo(
    () => (dateFrom ? parseYMDLocal(dateFrom) : undefined),
    [dateFrom]
  );
  const toDate = useMemo(() => (dateTo ? parseYMDLocal(dateTo) : undefined), [dateTo]);

  const fromLabel = useMemo(
    () => (fromDate ? format(fromDate, "dd MMM yyyy") : "Fecha inicial"),
    [fromDate]
  );
  const toLabel = useMemo(
    () => (toDate ? format(toDate, "dd MMM yyyy") : "Fecha final"),
    [toDate]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Mas filtros</SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4">
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="status">
              <AccordionTrigger>Estado</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {ORDER_STATUS_OPTIONS.map((status) => (
                  <div key={status} className="flex items-center gap-2">
                    <Checkbox
                      id={`order-status-${status}`}
                      checked={orderStatus.includes(status)}
                      onCheckedChange={() => onToggleOrderStatus(status)}
                    />
                    <Label htmlFor={`order-status-${status}`}>
                      {mapOrderStatusToSpanish(status)}
                    </Label>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="payment-status">
              <AccordionTrigger>Estado de pago</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {paymentOptions.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`payment-status-${option.value}`}
                      checked={paymentStatus.includes(option.value)}
                      onCheckedChange={() => onTogglePaymentStatus(option.value)}
                    />
                    <Label htmlFor={`payment-status-${option.value}`}>{option.label}</Label>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="date-range">
              <AccordionTrigger>Rango de fechas</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Fecha inicial</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left text-sm"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {fromLabel}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        initialFocus
                        mode="single"
                        selected={fromDate}
                        onSelect={(value) =>
                          onChangeDateFrom(value ? format(value, "yyyy-MM-dd") : "")
                        }
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Fecha final</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left text-sm"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {toLabel}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        initialFocus
                        mode="single"
                        selected={toDate}
                        onSelect={(value) =>
                          onChangeDateTo(value ? format(value, "yyyy-MM-dd") : "")
                        }
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="payment-method">
              <AccordionTrigger>Metodo de pago</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {safeMethods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay metodos disponibles.</p>
                ) : (
                  safeMethods.map((method) => (
                    <div key={method.uid} className="flex items-center gap-2">
                      <Checkbox
                        id={`payment-method-${method.uid}`}
                        checked={paymentMethods.includes(method.uid)}
                        onCheckedChange={() => onTogglePaymentMethod(method.uid)}
                      />
                      <Label htmlFor={`payment-method-${method.uid}`}>{method.name}</Label>
                    </div>
                  ))
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </ScrollArea>

        <SheetFooter>
          <Button variant="outline" onClick={onClearAll} className="w-full">
            Limpiar filtros
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

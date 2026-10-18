"use client";

import { CircleHelp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MarketCurrencyCode } from "@/components/dashboard/MarketCurrencyCode";

type MaximumUsesBlockProps = {
  limitTotalUses: boolean;
  onLimitTotalUsesChange: (checked: boolean) => void;
  maxTotalUses: number;
  onMaxTotalUsesChange: (value: number) => void;
  limitPerCustomer: boolean;
  onLimitPerCustomerChange: (checked: boolean) => void;
  maxUsesPerCustomer: number;
  onMaxUsesPerCustomerChange: (value: number) => void;
  limitTotalDiscountAmount: boolean;
  onLimitTotalDiscountAmountChange: (checked: boolean) => void;
  maxTotalDiscountAmount: number;
  onMaxTotalDiscountAmountChange: (value: number) => void;
  showTotalDiscountAmountLimit?: boolean;
};

export default function MaximumUsesBlock({
  limitTotalUses,
  onLimitTotalUsesChange,
  maxTotalUses,
  onMaxTotalUsesChange,
  limitPerCustomer,
  onLimitPerCustomerChange,
  maxUsesPerCustomer,
  onMaxUsesPerCustomerChange,
  limitTotalDiscountAmount,
  onLimitTotalDiscountAmountChange,
  maxTotalDiscountAmount,
  onMaxTotalDiscountAmountChange,
  showTotalDiscountAmountLimit = true,
}: MaximumUsesBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Usos máximos del descuento
          <CircleHelp className="h-5 w-5 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <CheckboxRow
            checked={limitTotalUses}
            label="Limitar la cantidad total de veces que se puede usar el descuento"
            onCheckedChange={onLimitTotalUsesChange}
          />
          {limitTotalUses ? (
            <Input
              type="text"
              inputMode="numeric"
              value={maxTotalUses}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === "") {
                  onMaxTotalUsesChange(0);
                  return;
                }
                const num = Number(raw);
                if (!isNaN(num)) {
                  onMaxTotalUsesChange(num);
                }
              }}
              className="h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : null}
        </div>

        <div className="space-y-2">
          <CheckboxRow
            checked={limitPerCustomer}
            label="Limitar la cantidad de veces que se puede usar por cliente"
            onCheckedChange={onLimitPerCustomerChange}
          />
          {limitPerCustomer ? (
            <Input
              type="text"
              inputMode="numeric"
              value={maxUsesPerCustomer}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === "") {
                  onMaxUsesPerCustomerChange(0);
                  return;
                }
                const num = Number(raw);
                if (!isNaN(num)) {
                  onMaxUsesPerCustomerChange(num);
                }
              }}
              className="h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : null}
        </div>

        {showTotalDiscountAmountLimit ? (
          <div className="space-y-2">
            <CheckboxRow
              checked={limitTotalDiscountAmount}
              label="Limitar el monto total de descuento"
              onCheckedChange={onLimitTotalDiscountAmountChange}
            />
            {limitTotalDiscountAmount ? (
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  <MarketCurrencyCode />
                </span>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={maxTotalDiscountAmount}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === "") {
                      onMaxTotalDiscountAmountChange(0);
                      return;
                    }
                    const num = Number(raw);
                    if (!isNaN(num)) {
                      onMaxTotalDiscountAmountChange(num);
                    }
                  }}
                  className="h-9 pl-7 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CheckboxRow({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex w-full items-center gap-2.5 text-left">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        className="size-5"
      />
      <button
        type="button"
        onClick={() => onCheckedChange(!checked)}
        className="text-sm font-medium text-left"
      >
        {label}
      </button>
    </div>
  );
}

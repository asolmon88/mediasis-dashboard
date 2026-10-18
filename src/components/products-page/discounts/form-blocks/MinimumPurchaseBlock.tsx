"use client";

import { CircleHelp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarketCurrencyCode } from "@/components/dashboard/MarketCurrencyCode";

type MinimumPurchaseBlockProps = {
  minimumRequirementType: "none" | "min_amount" | "min_items";
  onMinimumRequirementTypeChange: (value: "none" | "min_amount" | "min_items") => void;
  minAmount: number;
  onMinAmountChange: (value: number) => void;
  minItems: number;
  onMinItemsChange: (value: number) => void;
};

export default function MinimumPurchaseBlock({
  minimumRequirementType,
  onMinimumRequirementTypeChange,
  minAmount,
  onMinAmountChange,
  minItems,
  onMinItemsChange,
}: MinimumPurchaseBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Requisitos mínimos de compra
          <CircleHelp className="h-5 w-5 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioOption
          checked={minimumRequirementType === "none"}
          label="Sin requisitos mínimos"
          onClick={() => onMinimumRequirementTypeChange("none")}
        />

        <div className="space-y-2">
          <RadioOption
            checked={minimumRequirementType === "min_amount"}
            label="Monto mínimo de compra"
            onClick={() => onMinimumRequirementTypeChange("min_amount")}
          />
          {minimumRequirementType === "min_amount" ? (
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                <MarketCurrencyCode />
              </span>
              <Input
                type="text"
                inputMode="numeric"
                value={minAmount}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw === "") {
                    onMinAmountChange(0);
                    return;
                  }
                  const num = Number(raw);
                  if (!isNaN(num)) {
                    onMinAmountChange(num);
                  }
                }}
                className="h-9 pl-7 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <RadioOption
            checked={minimumRequirementType === "min_items"}
            label="Cantidad mínima de artículos"
            onClick={() => onMinimumRequirementTypeChange("min_items")}
          />
          {minimumRequirementType === "min_items" ? (
            <Input
              type="text"
              inputMode="numeric"
              value={minItems}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === "") {
                  onMinItemsChange(0);
                  return;
                }
                const num = Number(raw);
                if (!isNaN(num)) {
                  onMinItemsChange(num);
                }
              }}
              className="h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RadioOption({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 text-left"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
          checked ? "border-foreground" : "border-muted-foreground/40"
        }`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            checked ? "bg-foreground" : "bg-transparent"
          }`}
        />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

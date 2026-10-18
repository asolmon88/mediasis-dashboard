"use client";

import { useMemo, useState, useTransition } from "react";
import { CircleDollarSign } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { updateCashbackSettings } from "./actions";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type CashbackSettingsFormProps = {
  initialEnabled: boolean;
  initialPercentage: number;
};

export default function CashbackSettingsForm({
  initialEnabled,
  initialPercentage,
}: CashbackSettingsFormProps) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const formatMoney = (value: number) => new Intl.NumberFormat(market.locale, {
    style: "currency", currency: market.currencyCode,
  }).format(value);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [percentage, setPercentage] = useState(String(initialPercentage));
  const [isPending, startTransition] = useTransition();
  const [confirmCustomerAccounts, setConfirmCustomerAccounts] = useState(false);
  const numericPercentage = Number(percentage);
  const validPercentage = Number.isFinite(numericPercentage)
    ? Math.min(100, Math.max(0, numericPercentage))
    : 0;
  const example = useMemo(
    () => Math.round((10_000 * validPercentage) / 100 * 100) / 100,
    [validPercentage]
  );

  const persist = () => {
    startTransition(async () => {
      const result = await updateCashbackSettings({
        enabled,
        percentage: numericPercentage,
      });
      if (!result.success) {
        toast.error(result.message ?? "No se pudo guardar la configuración.");
        return;
      }
      toast.success("Configuración de cashback guardada.");
    });
  };

  const save = () => {
    if (enabled && !initialEnabled) { setConfirmCustomerAccounts(true); return; }
    persist();
  };

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Cashback</h1>
        <p className="text-sm text-muted-foreground">
          Premia a tus clientes por comprar directamente en tu app de pedidos.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CircleDollarSign className="size-5" />
            </span>
            <div className="space-y-1">
              <CardTitle>Cashback de la farmacia</CardTitle>
              <CardDescription>
                Tu farmacia financia el cashback acumulado y utilizado en su propia app.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div>
              <Label htmlFor="cashback-enabled" className="font-medium">
                Activar cashback
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Al desactivarlo, los saldos existentes se mantienen y pueden seguir utilizándose.
              </p>
            </div>
            <Switch
              id="cashback-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cashback-percentage">Porcentaje de cashback</Label>
            <div className="relative max-w-xs">
              <Input
                id="cashback-percentage"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={percentage}
                onChange={(event) => setPercentage(event.target.value)}
                disabled={isPending}
                className="pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Podés usar hasta dos decimales. Los cambios aplican únicamente a pedidos futuros.
            </p>
          </div>

          <div className="rounded-lg bg-muted/50 p-4">
            <p className="text-sm font-medium">Ejemplo</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Una compra elegible de {formatMoney(10_000)} acumularía{" "}
              <span className="font-semibold text-foreground">{formatMoney(example)}</span>.
            </p>
          </div>

          <Button
            type="button"
            onClick={save}
            disabled={
              isPending ||
              !Number.isFinite(numericPercentage) ||
              numericPercentage < 0 ||
              numericPercentage > 100
            }
          >
            {isPending ? "Guardando…" : "Guardar configuración"}
          </Button>
        </CardContent>
      </Card>
      <AlertDialog open={confirmCustomerAccounts} onOpenChange={setConfirmCustomerAccounts}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activar cuentas para clientes</AlertDialogTitle>
            <AlertDialogDescription>
              Para que tus clientes puedan consultar y usar su cashback desde la app de pedidos, vamos a preparar de forma segura la dirección principal de tu farmacia para registro e inicio de sesión.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmCustomerAccounts(false); persist(); }}>Continuar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

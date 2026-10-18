"use client";

import { useState } from "react";
import { toast } from "sonner";

import { correctBusinessMarket } from "@/app/admin/settings/market/actions";
import type { MarketCountryProfile } from "@/components/businesses/CreateBusinessForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BusinessMarket } from "@/lib/dashboard/auth-types";

export function MarketSettingsForm({ market, profiles, canCorrect }: {
  market: BusinessMarket;
  profiles: MarketCountryProfile[];
  canCorrect: boolean;
}) {
  const [countryCode, setCountryCode] = useState(market.countryCode);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = profiles.find((profile) => profile.countryCode === countryCode);

  const submit = async () => {
    setSaving(true);
    const result = await correctBusinessMarket({ countryCode, reason });
    setSaving(false);
    if (!result.success) return toast.error(result.message);
    toast.success(result.message);
    setReason("");
  };

  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label>País</Label>{canCorrect ? (
        <Select value={countryCode} onValueChange={setCountryCode}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{profiles.map((profile) => <SelectItem key={profile.countryCode} value={profile.countryCode}>{profile.countryName}</SelectItem>)}</SelectContent>
        </Select>
      ) : <Input readOnly value={`${market.countryName} (${market.countryCode})`} />}</div>
      <div className="space-y-2"><Label>Moneda</Label><Input readOnly value={selected?.currencyCode ?? market.currencyCode} /></div>
      <div className="space-y-2"><Label>Zona horaria</Label><Input readOnly value={selected?.timezone ?? market.timezone} /></div>
      <div className="space-y-2"><Label>Configuración regional</Label><Input readOnly value={selected?.locale ?? market.locale} /></div>
    </div>
    {canCorrect ? <div className="space-y-3 border-t pt-5">
      <div className="space-y-2"><Label htmlFor="market-reason">Motivo de la corrección</Label>
        <Input id="market-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mínimo 10 caracteres" />
      </div>
      <Button disabled={saving || reason.trim().length < 10} onClick={submit}>
        {saving ? "Guardando..." : "Corregir configuración"}
      </Button>
      <p className="text-sm text-muted-foreground">La corrección se bloqueará si el negocio ya tiene datos comerciales.</p>
    </div> : <p className="text-sm text-muted-foreground">Esta configuración es de solo lectura. Contactá a Mediasis si requiere una corrección.</p>}
  </div>;
}

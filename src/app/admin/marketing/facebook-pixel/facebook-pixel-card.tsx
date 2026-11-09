"use client";

import { useState, useTransition } from "react";
import { BarChart3, Eye, EyeOff, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { disconnectMetaPixel, getMetaPixelToken, saveMetaPixelSettings } from "./actions";

type Props = { pixelId: string | null; hasSavedToken: boolean; canManage: boolean };
const MASKED_TOKEN = "••••••••••••••••";

export function FacebookPixelCard({ pixelId, hasSavedToken, canManage }: Props) {
  const [pixelValue, setPixelValue] = useState(pixelId ?? "");
  const [configured, setConfigured] = useState(Boolean(pixelId));
  const [tokenValue, setTokenValue] = useState(hasSavedToken ? MASKED_TOKEN : "");
  const [tokenSaved, setTokenSaved] = useState(hasSavedToken);
  const [tokenDirty, setTokenDirty] = useState(false);
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<{ success: boolean; message: string } | null>(null);
  const validPixel = /^\d{5,30}$/.test(pixelValue.trim());
  const validToken = tokenDirty ? tokenValue.trim().length > 0 : tokenSaved;

  const toggleTokenVisibility = () => {
    if (tokenVisible) {
      setTokenVisible(false);
      return;
    }
    if (!tokenSaved || tokenDirty || tokenLoaded) {
      setTokenVisible(true);
      return;
    }
    startTransition(async () => {
      const result = await getMetaPixelToken();
      if (!result.success) {
        setActionMessage(result);
        return;
      }
      setTokenValue(result.token);
      setTokenLoaded(true);
      setTokenVisible(true);
      setActionMessage(null);
    });
  };

  const save = () => startTransition(async () => {
    const result = await saveMetaPixelSettings(pixelValue, tokenDirty ? tokenValue : null);
    setActionMessage(result);
    if (result.success) {
      setConfigured(true);
      setTokenSaved(true);
      setTokenDirty(false);
      setTokenVisible(false);
      if (!tokenLoaded) setTokenValue(MASKED_TOKEN);
    }
  });
  const disconnect = () => startTransition(async () => {
    const result = await disconnectMetaPixel();
    setActionMessage(result);
    if (result.success) {
      setConfigured(false);
      setPixelValue("");
      setTokenValue("");
      setTokenSaved(false);
      setTokenDirty(false);
      setTokenLoaded(false);
      setTokenVisible(false);
    }
  });
  return <Card><CardHeader><div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><BarChart3 className="size-5" /></div><CardTitle>Facebook pixel</CardTitle><CardDescription>Ingresá el ID de tu pixel y el token de la API de conversiones para enviar eventos desde el navegador y el servidor.</CardDescription></CardHeader><CardContent className="space-y-5 border-t pt-6">
    {actionMessage && <div className={`rounded-md border p-3 text-sm ${actionMessage.success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>{actionMessage.message}</div>}
    {!canManage && <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">Tu plan permite ver la conexión de Facebook pixel. Para cambiarla, contactá al equipo de Mediasis.</div>}
    <div className="space-y-2"><label htmlFor="pixel-id" className="text-sm font-medium">ID del pixel</label><Input id="pixel-id" inputMode="numeric" autoComplete="off" placeholder="Ingresá el ID de tu pixel" value={pixelValue} onChange={(event) => setPixelValue(event.target.value)} disabled={pending || !canManage} /></div>
    <div className="space-y-2">
      <label htmlFor="capi-token" className="text-sm font-medium">Token de la API de conversiones</label>
      <div className="relative">
        <Input id="capi-token" type={tokenVisible ? "text" : "password"} autoComplete="off" className="pr-11" placeholder="Ingresá el token generado en Meta" value={tokenValue} onFocus={(event) => { if (tokenSaved && !tokenLoaded && !tokenDirty) event.currentTarget.select(); }} onChange={(event) => { setTokenValue(event.target.value); setTokenDirty(true); }} disabled={pending || !canManage} />
        {canManage && <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-8 -translate-y-1/2" onClick={toggleTokenVisibility} disabled={pending} aria-label={tokenVisible ? "Ocultar token" : "Mostrar token"}>{tokenVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Generá este token en la configuración de la API de conversiones de tu pixel en Meta.</p>
    </div>
    {canManage && <div className="flex flex-wrap gap-3"><Button onClick={save} disabled={pending || !validPixel || !validToken}>{configured ? "Guardar cambios" : "Guardar configuración"}</Button>{configured && <Button variant="outline" onClick={disconnect} disabled={pending}><Unplug /> Desconectar</Button>}</div>}
  </CardContent></Card>;
}

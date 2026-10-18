"use client";

import { useState, useTransition } from "react";
import { BarChart3, CheckCircle2, ExternalLink, Server, Unplug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { disconnectMetaPixel, saveMetaPixelId } from "./actions";

type Props = { pixelId: string | null; serverEventsConnected: boolean; canManage: boolean };
const failureMessages: Record<string, string> = {
  "pixel-access": "No encontramos ese pixel entre los activos de tu cuenta de Meta. Revisá el ID y tu acceso al pixel.",
  "assignment-permission": "Meta no permitió asignar este pixel a la conexión. Revisá que tu cuenta tenga control total del pixel y del portafolio empresarial. Si ya lo tiene, contactá a soporte de Mediasis.",
  "authorization-invalid": "Tu autorización de Meta ya no es válida. Volvé a conectar tu cuenta.",
  temporary: "Meta no pudo completar la conexión en este momento. Esperá unos minutos e intentá de nuevo.",
  configuration: "No pudimos completar la conexión por un problema de configuración. Contactá a soporte de Mediasis.",
  unknown: "No pudimos conectar el pixel. Intentá de nuevo; si continúa, contactá a soporte de Mediasis.",
};
const messages: Record<string, string> = { connected: "Facebook pixel se conectó. Los nuevos eventos usarán la credencial guardada.", denied: "Cancelaste la autorización en Meta. Podés intentarlo de nuevo.", "oauth-failed": "Meta no pudo completar la autorización. Intentá de nuevo.", expired: "La sesión de conexión venció. Volvé a conectar el pixel.", "invalid-state": "La sesión de conexión venció. Volvé a conectar el pixel.", forbidden: "No tenés acceso a esta conexión.", "invalid-pixel": "Ingresá un ID de pixel válido.", unavailable: "La conexión de Meta todavía no está configurada en el servidor." };

export function FacebookPixelCard({ pixelId, serverEventsConnected, canManage }: Props) {
  const [value, setValue] = useState(pixelId ?? "");
  const [pending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<{ success: boolean; message: string } | null>(null);
  const params = useSearchParams();
  const result = params.get("meta");
  const reason = params.get("reason");
  const valid = /^\d{5,30}$/.test(value.trim());
  const connectServerEvents = () => { if (valid) window.location.assign(`/api/meta/connect?pixel_id=${encodeURIComponent(value.trim())}`); };
  const save = () => startTransition(async () => setActionMessage(await saveMetaPixelId(value)));
  const disconnect = () => startTransition(async () => {
    const result = await disconnectMetaPixel();
    setActionMessage(result);
    if (result.success) setValue("");
  });
  return <Card><CardHeader><div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><BarChart3 className="size-5" /></div><CardTitle>Facebook pixel</CardTitle><CardDescription>Ingresá el ID de tu pixel para medir visitas y acciones desde la app de pedidos. No necesitás iniciar sesión en Facebook.</CardDescription></CardHeader><CardContent className="space-y-5 border-t pt-6">
    {result && <div className={`rounded-md border p-3 text-sm ${result === "connected" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>{result === "connected" && <CheckCircle2 className="mr-2 inline size-4" />}{result === "failed" ? failureMessages[reason ?? "unknown"] : messages[result] ?? "No se pudo completar la operación."}</div>}
    {actionMessage && <div className={`rounded-md border p-3 text-sm ${actionMessage.success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>{actionMessage.message}</div>}
    {!canManage && <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">Tu plan permite ver la conexión de Facebook pixel. Para cambiarla, contactá al equipo de Mediasis.</div>}
    <div className="space-y-2"><label htmlFor="pixel-id" className="text-sm font-medium">ID del pixel</label><Input id="pixel-id" inputMode="numeric" placeholder="Ingresá el ID de tu pixel" value={value} onChange={(event) => setValue(event.target.value)} disabled={pending || !canManage} /></div>
    {pixelId && <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Eventos del navegador activos</p><p>La app de pedidos carga este pixel cuando el cliente acepta las cookies de medición.</p></div></div>}
    {canManage && <div className="flex flex-wrap gap-3"><Button onClick={save} disabled={pending || !valid}>{pixelId ? "Guardar cambios" : "Activar pixel"}</Button>{pixelId && <Button variant="outline" onClick={disconnect} disabled={pending}><Unplug /> Desconectar</Button>}</div>}
    {pixelId && <div className="space-y-3 rounded-md border p-4"><div className="flex items-start gap-3"><Server className="mt-0.5 size-4 shrink-0" /><div><p className="text-sm font-medium">Eventos del servidor</p><p className="text-sm text-muted-foreground">{serverEventsConnected ? "Activos. Mediasis también envía eventos mediante la API de conversiones y los deduplica con los del navegador." : "Opcionales. Meta exige una autorización con acceso a este pixel; el ID por sí solo no permite enviar eventos desde el servidor."}</p></div></div>{canManage && <Button variant="outline" onClick={connectServerEvents} disabled={pending || !valid}>{serverEventsConnected ? "Reconectar eventos del servidor" : "Conectar eventos del servidor"} <ExternalLink /></Button>}</div>}
    <p className="text-xs text-muted-foreground">No necesitás iniciar sesión en Facebook para los eventos del navegador. La autorización de Meta se solicita únicamente para los eventos del servidor.</p>
  </CardContent></Card>;
}

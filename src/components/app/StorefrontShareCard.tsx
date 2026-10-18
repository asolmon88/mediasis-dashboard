"use client";

import QRCode from "qrcode";
import { Check, Copy, Download, ExternalLink, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type StorefrontShareCardProps = {
  url: string | null;
  kind?: "custom_domain" | "mediasis_link";
};

export function StorefrontShareCard({ url, kind }: StorefrontShareCardProps) {
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!qrOpen || !url) return;
    let cancelled = false;
    setQrDataUrl(null);
    void QRCode.toDataURL(url, {
      width: 640,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#07111f", light: "#ffffff" },
    }).then((value) => {
      if (!cancelled) setQrDataUrl(value);
    }).catch(() => {
      if (!cancelled) toast.error("No se pudo generar el código QR.");
    });
    return () => { cancelled = true; };
  }, [qrOpen, url]);

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copiado.");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("No se pudo copiar el link.");
    }
  }

  if (!url) {
    return <p className="mt-3 text-center text-xs text-muted-foreground">Tu link público se habilitará cuando la app de pedidos esté lista.</p>;
  }

  return <>
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <Input aria-label="Link público de la app de pedidos" value={url} readOnly onFocus={(event) => event.currentTarget.select()} className="bg-background" />
        <Button type="button" variant="outline" size="icon" onClick={copyLink} aria-label="Copiar link">
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setQrOpen(true)}><QrCode className="size-4" /> Código QR</Button>
        <Button type="button" size="sm" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Abrir app</a></Button>
      </div>
    </div>
    <Dialog open={qrOpen} onOpenChange={setQrOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Código QR de tu app</DialogTitle>
          <DialogDescription>Escanealo o descargalo para compartir el link de tu negocio.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-60 items-center justify-center rounded-xl bg-white p-4">
          {qrDataUrl ? <img src={qrDataUrl} alt={`Código QR para ${url}`} className="size-56 object-contain" /> : <div className="size-10 animate-spin rounded-full border-4 border-muted border-t-primary" aria-label="Generando código QR" />}
        </div>
        <Button type="button" asChild disabled={!qrDataUrl} className="w-full">
          <a href={qrDataUrl ?? undefined} download="codigo-qr-mediasis.png"><Download className="size-4" /> Descargar PNG</a>
        </Button>
      </DialogContent>
    </Dialog>
  </>;
}

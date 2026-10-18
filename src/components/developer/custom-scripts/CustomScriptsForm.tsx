"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { updateCustomTrackingCode } from "@/app/admin/developer/custom-scripts/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MAX_CODE_BYTES = 50 * 1024;

type CustomScriptsFormProps = {
  initialCode: string;
};

export default function CustomScriptsForm({ initialCode }: CustomScriptsFormProps) {
  const [code, setCode] = useState(initialCode);
  const [savedCode, setSavedCode] = useState(initialCode);
  const [isSaving, setIsSaving] = useState(false);
  const byteLength = useMemo(() => new TextEncoder().encode(code).length, [code]);
  const isTooLarge = byteLength > MAX_CODE_BYTES;
  const hasChanges = code !== savedCode;

  const handleSave = async () => {
    if (isTooLarge || !hasChanges) return;

    setIsSaving(true);
    const result = await updateCustomTrackingCode({ custom_tracking_code: code });
    setIsSaving(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    setSavedCode(code);
    toast.success(result.message);
  };

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Scripts personalizados</h1>
        <p className="text-sm text-muted-foreground">
          Agrega códigos de seguimiento o integraciones de terceros a todas las páginas de tu app de pedidos.
        </p>
      </div>

      <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <p className="font-medium">Agrega únicamente código de proveedores de confianza.</p>
          <p className="text-muted-foreground">
            Estos scripts se ejecutan en la tienda y pueden acceder a información visible durante la navegación y el checkout.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="custom-tracking-code">Código HTML o JavaScript</Label>
        <Textarea
          id="custom-tracking-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={'<!-- Pega aquí el código completo -->\n<script>\n  // Código del proveedor\n</script>'}
          className="min-h-80 resize-y font-mono text-sm"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="flex items-center justify-between gap-4 text-xs">
          <p className={isTooLarge ? "text-destructive" : "text-muted-foreground"}>
            {isTooLarge ? "El código supera el límite de 50 KB." : "Guarda el campo vacío para desactivar el código personalizado."}
          </p>
          <p className={isTooLarge ? "font-medium text-destructive" : "text-muted-foreground"}>
            {(byteLength / 1024).toFixed(1)} / 50 KB
          </p>
        </div>
      </div>

      <Button type="button" onClick={handleSave} disabled={isSaving || isTooLarge || !hasChanges}>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {isSaving ? "Guardando..." : "Guardar y activar"}
      </Button>
    </div>
  );
}


import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function PlanUpgradePrompt({ feature, selfService }: { feature: string; selfService: boolean }) {
  return <main className="mx-auto w-full max-w-3xl p-4 md:p-8">
    <Card><CardHeader><CardTitle>{feature} está disponible en Basic</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>Tu plan actual no incluye esta función. La configuración anterior se conserva, pero no se utilizará mientras no esté incluida en tu plan.</p>
        {selfService ? <Button asChild><Link href="/admin/settings/billing">Ver cambio de plan</Link></Button>
          : <p>Contactá al equipo de Mediasis para revisar las opciones de tu negocio.</p>}
      </CardContent></Card>
  </main>;
}

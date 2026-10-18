import { ShieldX } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DashboardAccessDeniedProps = {
  title?: string;
  description?: string;
};

export function DashboardAccessDenied({
  title = "Sin acceso",
  description = "Tu cuenta no tiene permiso para ver esta sección. Podés cambiar de negocio desde el menú de usuario o contactar a un administrador.",
}: DashboardAccessDeniedProps = {}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <ShieldX className="size-10 text-muted-foreground" />
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          {description}
        </CardContent>
      </Card>
    </div>
  );
}

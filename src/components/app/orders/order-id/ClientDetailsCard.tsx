"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderDetailClient } from "@/lib/types/dashboardTypes";

type ClientDetailsCardProps = {
  client: OrderDetailClient | null;
};

export function ClientDetailsCard({ client }: ClientDetailsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cliente</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <p className="font-semibold">
          {client
            ? `${client.first_name} ${client.last_name}`
            : "No hay informacion del cliente"}
        </p>
        <div className="text-muted-foreground space-y-1">
          <p>{client?.phone_number ?? "No hay telefono"}</p>
          <p>{client?.email ?? "No hay email"}</p>
        </div>
      </CardContent>
    </Card>
  );
}

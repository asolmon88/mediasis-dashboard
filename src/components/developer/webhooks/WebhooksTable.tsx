"use client";

import { RotateCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  BusinessLocations,
  BusinessWebhookRow,
  BusinessWebhookRows,
} from "@/lib/types/dashboardTypes";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type WebhooksTableProps = {
  webhooks: BusinessWebhookRows;
  businessLocations: BusinessLocations;
  pendingWebhookId?: string | null;
  onRotate: (webhook: BusinessWebhookRow) => void;
  onDelete: (webhook: BusinessWebhookRow) => void;
};

function formatDate(value: string, locale: string, timeZone: string) {
  if (!value) return "Sin fecha";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";

  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone }).format(date);
}

function getLocationNames(webhook: BusinessWebhookRow, businessLocations: BusinessLocations) {
  return webhook.location_ids.map((locationId) => {
    const location = businessLocations.find(
      (item) => item.business_location_id === locationId,
    );

    return location?.short_name ?? locationId;
  });
}

export default function WebhooksTable({
  webhooks,
  businessLocations,
  pendingWebhookId,
  onRotate,
  onDelete,
}: WebhooksTableProps) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold">Webhooks configurados</CardTitle>
        <CardDescription>
          Estos endpoints recibirán eventos según su configuración de alcance.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Endpoint</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Eventos</TableHead>
              <TableHead>Ubicaciones</TableHead>
              <TableHead>Secreto</TableHead>
              <TableHead>Actualizado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.length > 0 ? (
              webhooks.map((webhook) => (
                <TableRow key={webhook.webhook_id}>
                  <TableCell className="max-w-[280px]">
                    <div className="flex flex-col gap-1">
                      <span className="truncate font-medium">{webhook.endpoint_url}</span>
                      <span className="text-xs text-muted-foreground">
                        Creado {formatDate(webhook.created_at, market.locale, market.timezone)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        webhook.enabled
                          ? "bg-emerald-100 text-emerald-700 border-transparent"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {webhook.enabled ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {webhook.event_types.length > 0 ? (
                        webhook.event_types.map((eventType) => (
                          <Badge key={eventType} variant="outline">
                            {eventType}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin eventos</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {webhook.scope === "specific" ? (
                      <div className="flex flex-wrap gap-1">
                        {getLocationNames(webhook, businessLocations).map((locationName) => (
                          <Badge key={locationName} variant="outline">
                            {locationName}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      "Todas"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={webhook.has_secret ? "outline" : "secondary"}>
                      {webhook.has_secret ? "Configurado" : "Sin secreto"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(webhook.updated_at, market.locale, market.timezone)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pendingWebhookId === webhook.webhook_id}
                        onClick={() => onRotate(webhook)}
                      >
                        <RotateCw className="h-4 w-4" />
                        Rotar secreto
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={pendingWebhookId === webhook.webhook_id}
                        onClick={() => onDelete(webhook)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No hay webhooks configurados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

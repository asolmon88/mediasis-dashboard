"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatOrderOptions } from "@/lib/utils";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type TrackingDetailsCardProps = {
  deliveryMethodName: string | null;
  trackingLink: string | null;
  dropOffLat: number | null;
  dropOffLng: number | null;
  options: unknown;
};

export function TrackingDetailsCard({
  deliveryMethodName,
  trackingLink,
  dropOffLat,
  dropOffLng,
  options,
}: TrackingDetailsCardProps) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const orderOptions = formatOrderOptions(options, (value) => new Intl.NumberFormat(market.locale, {
    style: "currency", currency: market.currencyCode,
  }).format(value));
  const hasDropOffLocation = dropOffLat !== null && dropOffLng !== null;
  const googleMapsLink = hasDropOffLocation
    ? `https://www.google.com/maps/search/?api=1&query=${dropOffLat},${dropOffLng}`
    : null;
  const wazeLink = hasDropOffLocation
    ? `https://waze.com/ul?ll=${dropOffLat},${dropOffLng}&navigate=yes`
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Entrega y opciones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Metodo de entrega</span>
          <span>{deliveryMethodName ?? "No hay informacion de delivery"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Link de rastreo</span>
          {trackingLink ? (
            <a href={trackingLink} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
              Ver link
            </a>
          ) : (
            <span>No hay informacion de rastreo</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Drop off lat</span>
          <span>{dropOffLat ?? "No hay informacion"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Drop off lng</span>
          <span>{dropOffLng ?? "No hay informacion"}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Ver ubicacion</span>
          {googleMapsLink && wazeLink ? (
            <div className="flex items-center gap-3">
              <a
                href={googleMapsLink}
                className="text-blue-600 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Google Maps
              </a>
              <a href={wazeLink} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                Waze
              </a>
            </div>
          ) : (
            <span>No hay informacion</span>
          )}
        </div>
        <div className="pt-2">
          <p className="text-muted-foreground mb-2">Opciones del pedido</p>
          {orderOptions.length > 0 ? (
            <ul className="space-y-2 text-xs text-muted-foreground">
              {orderOptions.map((option, index) => (
                <li
                  key={
                    option.type === "text"
                      ? `${option.label}-${option.value}-${index}`
                      : `${option.label}-${option.mediaUrl}-${index}`
                  }
                  className="flex flex-col gap-2"
                >
                  <span className="block">{option.label}</span>
                  {option.type === "text" ? (
                    <span className="block font-semibold text-foreground">{option.value}</span>
                  ) : null}
                  {option.type === "media" ? (
                    <a
                      href={option.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-blue-600 hover:underline"
                    >
                      <img
                        src={option.mediaUrl}
                        alt={option.label}
                        className="h-12 w-12 rounded-md object-cover border"
                      />
                      Ver imagen
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No hay informacion de opciones</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

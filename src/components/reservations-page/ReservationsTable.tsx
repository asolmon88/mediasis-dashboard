'use client';

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { statusColors, statusOptions } from "@/lib/dashboardData";
import { DrawerDialogDemo } from "../EditFormDrawer";
import { Skeleton } from "../ui/skeleton";
import { Reservation } from "@/lib/types/dashboardTypes";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
import { marketDateKey } from "@/lib/dashboard/market";

export default function ReservationsTable({
  date,
  reservations,
  loading
}:{
  date: Date,
  reservations: Reservation[] | null,
  loading: boolean
}) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");

  const targetYMD = marketDateKey(date, market.timezone);
  const filtered = reservations?.filter((res) => {
    return marketDateKey(res.date, market.timezone) === targetYMD
  }) ?? [];

  return (
    <Card>
    <CardHeader>
      <CardTitle>Lista de reservaciones</CardTitle>
      <CardDescription>Da click sobre una para editar</CardDescription>
    </CardHeader>
    <CardContent>
      {
        loading ? 
          <div className="flex flex-col space-y-4">
            <div className="flex flex-row justify-evenly">
              <Skeleton className="h-2 w-1/4"/>
              <Skeleton className="h-2 w-1/4"/>
              <Skeleton className="h-2 w-1/4"/>
            </div>
            <Skeleton className="h-2 w-full"/>
            <Skeleton className="h-2 w-full"/>
            <Skeleton className="h-2 w-full"/>
            <Skeleton className="h-2 w-full"/>
          </div> :
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Cliente</TableHead>
              <TableHead className="hidden md:table-cell">Creada</TableHead>
              <TableHead className="hidden md:table-cell">Última actualización</TableHead>
              <TableHead className="text-right">Fecha de reserva</TableHead>
              <TableHead className="text-right">Tamaño</TableHead>
              <TableHead className="text-right">Estado</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (filtered.map((res) => (
              <TableRow key={res.id}>
                <TableCell className="font-medium">
                  {res.client && !Array.isArray(res.client) ? (
                    `${res.client.first_name} ${res.client.last_name}`
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {new Date(res.created_at).toLocaleString(market.locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: market.timezone,
                  })}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {new Date(res.updated_at).toLocaleString(market.locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: market.timezone,
                  })}
                </TableCell>
                <TableCell className="text-right">
                  {new Date(res.date).toLocaleString(market.locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: market.timezone,
                  })}
                </TableCell>
                <TableCell className="text-right">{res.size}</TableCell>
                <TableCell className="text-right capitalize">
                  {(Object.entries(statusOptions) as [keyof typeof statusOptions, string][]).map(([spanish, eng]) =>
                    eng === res.status ? (
                      <Badge
                        key={res.id}
                        variant="secondary"
                        className={`${statusColors[spanish]} text-background`}
                      >
                        {spanish}
                      </Badge>
                    ) : null
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <DrawerDialogDemo reservation={res} />
                </TableCell>
              </TableRow>
            ))) :
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No hay reservaciones para este día
                </TableCell>
              </TableRow>
            }
          </TableBody>
        </Table>
      }
    </CardContent>
  </Card>
  );
}

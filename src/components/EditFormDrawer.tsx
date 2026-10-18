"use client"

import * as React from "react"

import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Reservation } from "@/lib/types/dashboardTypes"
import ReservationEditForm from "./reservations-page/ReservationEditForm"
import { useEffect, useState } from "react"
import Link from "next/link"

export function DrawerDialogDemo({ reservation }:{
  reservation: Reservation;
}) {
  const [open, setOpen] = useState(false)
  const [client, setClient] = useState<{
    phone_number: string;
    first_name: string;
    last_name: string;
  }>({phone_number:'', first_name:'', last_name:''})
  const isDesktop = useMediaQuery("(min-width: 768px)")

  useEffect(() => {
    if (typeof reservation.client === 'object') {
      const clientConverted = reservation.client as {
        phone_number: string;
        first_name: string;
        last_name: string;
      }
      setClient(clientConverted);
    }
  }, [reservation])

  const Info = ({title, value, url}:{title:string; value?:string; url?:string}) => {
    if (url && url !== 'N/A') {
      return (
        <p className="text-xs"><span className="font-bold">{title}</span> <a target="_blank" href={url} rel="noopener noreferrer" className="underline">Vea el comprobante aquí</a></p>
      );
    }
    return (
      <p className="text-xs"><span className="font-bold">{title}</span> {value}</p>
    );
  }
  

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Editar</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Editar reserva</DialogTitle>
            <DialogDescription asChild>
              <div>
                <p className="font-semibold text-sm">Información de la reserva</p>
                <Info title="Creada:" value={new Date(reservation.created_at).toLocaleString('es-ES')}/>
                <Info title="Última actualización:" value={new Date(reservation.updated_at).toLocaleString('es-ES')}/>
                <Info title="Hecha por:" value={`${client.first_name} ${client.last_name}`}/>
                <Info title="Número:" value={client.phone_number}/>
                <Info title="Detalles:" value={reservation.extra_details !== null && reservation.extra_details !== '' ? reservation.extra_details : 'N/A'}/>
                <Info title="Monto Pagado:" value={reservation.price ? reservation.price.toString() : 'N/A'}/>
                <Info title="URL del comprobante:" url={reservation.payment_proof_url ? reservation.payment_proof_url : 'N/A'} value="N/A"/>
              </div>
            </DialogDescription>
          </DialogHeader>
          <ReservationEditForm reservation={reservation}/>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline">Editar</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>Editar reserva</DrawerTitle>
          <DrawerDescription asChild>
            <div>
              <p className="font-semibold text-sm">Información de la reserva</p>
              <Info title="Creada:" value={new Date(reservation.created_at).toLocaleString('es-ES')}/>
              <Info title="Última alcualización:" value={new Date(reservation.updated_at).toLocaleString('es-ES')}/>
              <Info title="Hecha por:" value={`${client.first_name} ${client.last_name}`}/>
              <Info title="Número:" value={client.phone_number}/>
              <Info title="Monto Pagado:" value={reservation.price ? reservation.price.toString() : 'N/A'}/>
              <Info title="URL del comprobante:" url={reservation.payment_proof_url ? reservation.payment_proof_url : 'N/A'} value="N/A"/>
            </div>
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4">
          <ReservationEditForm reservation={reservation}/>
        </div>
        <DrawerFooter className="pt-2">
          <DrawerClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

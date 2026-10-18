"use client";

import { ReactNode, useMemo, useState } from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
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
import { useMediaQuery } from "@/hooks/use-media-query";
import { Plus } from "lucide-react";
import { Button } from "../ui/button";
import { GoogleMapProvider } from "@/providers/GoogleMapProvider";
import LocationAddEditForm from "./LocationAddForm";
import { ScrollArea } from "@/components/ui/scroll-area"
import { BusinessLocation } from "@/lib/types/dashboardTypes";

type LocationAddEditLayoutProps = {
  location?: BusinessLocation
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function LocationAddEditLayout({
  location,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: LocationAddEditLayoutProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen
  const formId = location
    ? `location-edit-form-${location.business_location_id}`
    : "location-add-form"
  const title = useMemo(
    () => (location ? "Editar ubicación" : "Ubicación nueva"),
    [location]
  )
  const description = useMemo(
    () =>
      location
        ? "Actualice los datos de esta ubicación del negocio."
        : "Llene los datos de abajo para agregar una nueva ubicación de este negocio.",
    [location]
  )

  const defaultTrigger = (
    <div className="gap-2 p-2 flex flex-row items-center hover:cursor-pointer hover:bg-ring/20 text-sm rounded-sm">
      <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
        <Plus className="size-4" />
      </div>
      <div className="text-muted-foreground font-medium">Agregar local</div>
    </div>
  )

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        {trigger ? (
          <SheetTrigger asChild>
            {trigger}
          </SheetTrigger>
        ) : controlledOpen === undefined ? (
          <SheetTrigger asChild>
            {defaultTrigger}
          </SheetTrigger>
        ) : null}
        <SheetContent side="right" className="flex h-dvh max-h-dvh w-full flex-col gap-0 sm:max-w-xl">
          <SheetHeader className="shrink-0 pb-4">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>
              {description}
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1 pr-4">
            <GoogleMapProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAP_API_KEY!}>
              <LocationAddEditForm
                formId={formId}
                hideSubmitButton
                location={location}
                onSuccess={() => setOpen(false)}
              />
            </GoogleMapProvider>
          </ScrollArea>
          <SheetFooter className="shrink-0 pt-4">
            <Button type="submit" form={formId}>
              {location ? "Editar" : "Agregar"}
            </Button>
            <SheetClose asChild>
              <Button variant="outline">Cerrar</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      fixed
      repositionInputs={false}
      handleOnly
      shouldScaleBackground={false}
    >
      {trigger ? (
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
      ) : controlledOpen === undefined ? (
        <DrawerTrigger asChild>
          {defaultTrigger}
        </DrawerTrigger>
      ) : null}
      <DrawerContent className="flex h-dvh max-h-dvh flex-col rounded-none border-t-0 pb-[env(safe-area-inset-bottom)]">
        <DrawerHeader className="shrink-0 border-b bg-background pb-3 pt-[max(1rem,env(safe-area-inset-top))] text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>
            {description}
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6 pt-2 [scroll-padding-bottom:12rem] [-webkit-overflow-scrolling:touch]">
          <GoogleMapProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAP_API_KEY!}>
            <LocationAddEditForm
              formId={formId}
              hideSubmitButton
              location={location}
              onSuccess={() => setOpen(false)}
            />
          </GoogleMapProvider>
        </div>
        <DrawerFooter className="shrink-0 border-t bg-background pt-3">
          <Button type="submit" form={formId}>
            {location ? "Editar" : "Agregar"}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline">Cerrar</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

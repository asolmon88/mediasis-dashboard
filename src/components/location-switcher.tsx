"use client"
// Cadena by pepe
// Cheers lindora Cheers belen y cheers heredia
// 
import * as React from "react"
import { ChevronsUpDown, Edit, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { retireBusinessLocation } from "@/app/admin/locations/actions"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  // DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { BusinessLocation } from "@/lib/types/dashboardTypes"
import { usePathname, useRouter } from "next/navigation"
import {
  useActiveLocation,
  useBusinessLocations,
  useLocationStore,
} from "@/stores/location-store"
import LocationAddEditLayout from "./locations/LocationAddEditLayout"
import { Button } from "./ui/button"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"

const initialsFor = (name: string) =>
  name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase()

export function LocationSwitcher() {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const pathname = usePathname()
  const authorization = useDashboardAuthorization()
  const activeBusiness = authorization.businesses.find(
    (business) => business.businessId === authorization.activeBusinessId,
  )
  const activeBusinessName = activeBusiness?.name ?? "Negocio Mediasis"
  const activeBusinessLogo = activeBusiness?.avatarUrl ?? "/images/mediasis-logo.png"
  const activeLocation = useActiveLocation()
  const locations = useBusinessLocations()
  const selectLocation = useLocationStore((state) => state.selectLocation)
  const removeLocation = useLocationStore((state) => state.removeLocation)
  const locationChangeBlocked = useLocationStore(
    (state) => state.locationChangeBlocked
  )
  const [locationEditorOpen, setLocationEditorOpen] = React.useState(false)
  const [editingLocation, setEditingLocation] = React.useState<
    BusinessLocation | undefined
  >(undefined)
  const [deleteTarget, setDeleteTarget] = React.useState<
    BusinessLocation | undefined
  >(undefined)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isMenuOpen, setIsMenuOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [pendingLocation, setPendingLocation] = React.useState<
    BusinessLocation | undefined
  >(undefined)

  const handleSelectLocation = (location: BusinessLocation) => {
    if (location.business_location_id === activeLocation?.business_location_id) return
    if (locationChangeBlocked) {
      setPendingLocation(location)
      setIsMenuOpen(false)
      return
    }
    selectLocation(location.business_location_id)
  }

  const handleLocationEditorOpenChange = (open: boolean) => {
    setLocationEditorOpen(open)
    if (!open) {
      setEditingLocation(undefined)
    }
  }

  const reservationRoute = authorization.mode !== "legacy" && [
    "/admin/reservations",
    "/admin/open-hours",
    "/admin/closed-days",
  ].some((route) => pathname.startsWith(route))
  const selectableLocations = reservationRoute
    ? locations.filter((location) =>
        authorization.reservationLocationIds.includes(location.business_location_id)
      )
    : locations
  const displayedActiveLocation = reservationRoute
    ? selectableLocations.find((location) =>
        location.business_location_id === activeLocation?.business_location_id
      ) ?? selectableLocations[0]
    : activeLocation
  const filteredLocations = selectableLocations.filter((location) =>
    location.short_name.toLowerCase().includes(search.trim().toLowerCase())
  )

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
  }

  const handleDeleteLocation = async () => {
    if (!deleteTarget) return

    setIsDeleting(true)

    try {
      const result = await retireBusinessLocation(deleteTarget.business_location_id)
      if (!result.success) throw new Error(result.message ?? "No se pudo retirar la ubicación.")

      removeLocation(deleteTarget.business_location_id)

      if (editingLocation?.business_location_id === deleteTarget.business_location_id) {
        setEditingLocation(undefined)
        setLocationEditorOpen(false)
      }

      toast.success("Ubicación retirada.")
      setDeleteTarget(undefined)
      router.refresh()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo retirar la ubicación."
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <SidebarMenu className="min-w-0 flex-1">
        <SidebarMenuItem>
        <DropdownMenu
          open={isMenuOpen}
          onOpenChange={(open) => {
            setIsMenuOpen(open)
            if (!open) {
              setSearch("")
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={`${activeBusinessName} · ${displayedActiveLocation?.short_name ?? "Sin locales"}`}
              className="dashboard-control h-14 rounded-xl px-2.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1.5!"
            >
              <Avatar className="size-9 shrink-0 rounded-full border border-sidebar-border bg-background">
                <AvatarImage src={activeBusinessLogo} alt={`Logo de ${activeBusinessName}`} className="object-cover" />
                <AvatarFallback className="rounded-full text-[11px] font-semibold">
                  {initialsFor(activeBusinessName)}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">{activeBusinessName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {displayedActiveLocation?.short_name ?? "Sin locales"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 overflow-hidden rounded-lg p-0"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <div className="flex flex-col bg-popover">
              <DropdownMenuLabel className="px-3 pt-3">
                <span className="block truncate text-sm font-medium text-foreground">{activeBusinessName}</span>
                <span className="block pt-0.5 text-xs font-normal text-muted-foreground">Locales</span>
              </DropdownMenuLabel>
              <div className="px-2 pb-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Buscar local"
                  className="h-8"
                />
              </div>
              <ScrollArea className="h-72">
                <div className="space-y-1 px-1">
                {filteredLocations.length > 0 ? (
                  filteredLocations.map((location) => (
                    <DropdownMenuItem
                      key={location.business_location_id}
                      onClick={() => handleSelectLocation(location)}
                      onSelect={(event) => {
                        if ((event.target as HTMLElement)?.closest('[data-location-action="true"]')) {
                          event.preventDefault()
                        }
                      }}
                      className="flex justify-between items-center"
                    >
                      {location.short_name}
                      {!reservationRoute ? <div className="flex flex-row space-x-2">
                        <Button
                          variant="outline"
                          className="cursor-pointer rounded-full"
                          data-location-action="true"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setEditingLocation(location)
                            setLocationEditorOpen(true)
                            setIsMenuOpen(false)
                          }}
                        >
                          <Edit />
                        </Button>
                        <Button
                          variant="outline"
                          className="cursor-pointer rounded-full"
                          data-location-action="true"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setDeleteTarget(location)
                            setIsMenuOpen(false)
                          }}
                        >
                          <X />
                        </Button>
                      </div> : null}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="px-2 py-3 text-sm text-muted-foreground">
                    No se encontraron locales.
                  </div>
                )}
                </div>
              </ScrollArea>
              {!reservationRoute ? <div className="relative z-10 border-t bg-popover p-2">
                <DropdownMenuItem
                  className="gap-2 p-2"
                  onSelect={(event) => {
                    event.preventDefault()
                    setEditingLocation(undefined)
                    setLocationEditorOpen(true)
                    setIsMenuOpen(false)
                  }}
                >
                  <div className="gap-2 flex flex-row items-center text-sm rounded-sm">
                    <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                      <Plus className="size-4" />
                    </div>
                    <div className="text-muted-foreground font-medium">Agregar local</div>
                  </div>
                </DropdownMenuItem>
                </div> : null}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <LocationAddEditLayout
          open={locationEditorOpen}
          onOpenChange={handleLocationEditorOpenChange}
          location={editingLocation}
        />
        </SidebarMenuItem>
      </SidebarMenu>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteTarget(undefined)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Retirar este local?</AlertDialogTitle>
            <AlertDialogDescription>
              El local dejará de aparecer en el panel y en la tienda. Sus pedidos, reservaciones y registros de cashback se conservarán.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteLocation()
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Retirando..." : "Retirar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!pendingLocation}
        onOpenChange={(open) => {
          if (!open) setPendingLocation(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cambiar de ubicación?</AlertDialogTitle>
            <AlertDialogDescription>
              Hay cambios de horario sin guardar. Si cambias de ubicación, esos cambios se perderán.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingLocation) {
                  selectLocation(pendingLocation.business_location_id)
                }
                setPendingLocation(undefined)
              }}
            >
              Descartar y cambiar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

"use client"

import * as React from "react"

// import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { LocationSwitcher } from "@/components/location-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ModeToggle } from "./ModeToggle"
import { data } from "@/lib/dashboardData"
import Image from "next/image";
import { NavMain } from "./nav-main"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"
import { Settings } from "lucide-react"

export function AppSidebar({ billingLocked = false, ...props }: React.ComponentProps<typeof Sidebar> & { billingLocked?: boolean }) {
  const authorization = useDashboardAuthorization()
  const canAccessMetaPixel = Boolean(authorization.activeBusinessId)
  const projects = authorization.mode === "legacy"
    ? data.projects.filter((project) => project.name !== "Marketing" || canAccessMetaPixel)
    : data.projects.filter((project) =>
        project.name === "Inicio" ||
        (project.name === "Órdenes" && (
          authorization.permissions.includes("orders.manage.full") ||
          authorization.permissions.includes("*")
        )) ||
        (project.name === "Productos" && (
          authorization.permissions.includes("products.manage.full") ||
          authorization.permissions.includes("*")
        )) ||
        (project.name === "App de pedidos" && (
          authorization.permissions.includes("ordering_app.storefront.manage.full") ||
          authorization.permissions.includes("ordering_app.delivery.manage.full") ||
          authorization.permissions.includes("ordering_app.schedules.manage.full") ||
          authorization.permissions.includes("ordering_app.payment_methods.manage.full") ||
          authorization.permissions.includes("ordering_app.cashback.manage.full") ||
          authorization.permissions.includes("*")
        )) ||
        (project.name === "App de dashboard" && (
          authorization.permissions.includes("dashboard_app.automatic_statuses.manage.full") ||
          authorization.permissions.includes("*")
        )) ||
        (project.name === "Marketing" && canAccessMetaPixel) ||
        (project.name === "Reservaciones" &&
          authorization.reservationLocationIds.length > 0 && (
            authorization.permissions.includes("reservations.manage.full") ||
            authorization.permissions.includes("*")
          )) ||
        (project.name === "Desarrollador" && (
          authorization.permissions.includes("developer.manage.full") ||
          authorization.permissions.includes("*")
        ))
      )
  const visibleProjects = authorization.mode !== "legacy"
    ? projects.map((project) => project.name === "App de pedidos" ? {
        ...project,
        items: project.items?.filter((item) => {
          if (["/admin/app/start", "/admin/app/checkout", "/admin/app/appearance"].includes(item.url)) {
            return authorization.permissions.includes("ordering_app.storefront.manage.full") || authorization.permissions.includes("*")
          }
          if (item.url === "/admin/app/delivery") {
            return authorization.permissions.includes("ordering_app.delivery.manage.full") || authorization.permissions.includes("*")
          }
          if (["/admin/app/open-hours", "/admin/app/closed-special-hours"].includes(item.url)) {
            return authorization.permissions.includes("ordering_app.schedules.manage.full") || authorization.permissions.includes("*")
          }
          if (item.url === "/admin/app/payment-methods") {
            return authorization.permissions.includes("ordering_app.payment_methods.manage.full") || authorization.permissions.includes("*")
          }
          if (item.url === "/admin/app/cashback") {
            return authorization.permissions.includes("ordering_app.cashback.manage.full") || authorization.permissions.includes("*")
          }
          return false
        }),
      } : project.name === "App de dashboard" ? {
        ...project,
        items: project.items?.filter((item) =>
          ["/admin/dashboard-app/automatic-statuses", "/admin/dashboard-app/daily-preparation-reset"].includes(item.url) && (
            authorization.permissions.includes("dashboard_app.automatic_statuses.manage.full") ||
            authorization.permissions.includes("*")
          )
        ),
      } : project.name === "Reservaciones" ? {
        ...project,
        items: project.items?.filter(() =>
          authorization.reservationLocationIds.length > 0 && (
            authorization.permissions.includes("reservations.manage.full") ||
            authorization.permissions.includes("*")
          )
        ),
      } : project.name === "Desarrollador" ? {
        ...project,
        items: project.items?.filter(() =>
          authorization.permissions.includes("developer.manage.full") ||
          authorization.permissions.includes("*")
        ),
      } : project)
    : projects
  const settingsItems = [
    ...(authorization.mode === "legacy" || authorization.permissions.includes("billing.read") || authorization.permissions.includes("billing.manage") || authorization.permissions.includes("*")
      ? [{ title: "Facturación", url: "/admin/settings/billing" }] : []),
    ...(authorization.mode === "legacy" || authorization.permissions.includes("domains.read") || authorization.permissions.includes("domains.manage") || authorization.permissions.includes("*")
      ? [{ title: "Dominios", url: "/admin/settings/domains" }] : []),
    ...(authorization.mode !== "legacy" && (authorization.permissions.includes("members.read") || authorization.permissions.includes("*"))
      ? [{ title: "Usuarios", url: "/admin/settings/users" }] : []),
    ...(authorization.mode === "legacy" || authorization.permissions.includes("business.market_settings.read") || authorization.permissions.includes("*")
      ? [{ title: "País y región", url: "/admin/settings/market" }] : []),
    ...(authorization.activeBusinessId ? [{ title: "Negocio", url: "/admin/settings/business" }] : []),
  ]
  const clerkSettings = settingsItems.length ? [{
    title: "Configuración",
    url: "#",
    icon: Settings,
    isActive: true,
    items: settingsItems,
  }] : []
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-4 border-b border-sidebar-border/70 px-4 pb-4 pt-5 group-data-[collapsible=icon]:px-2">
        <div className="flex h-12 items-center px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Image src="/mediasis-logo.png" alt="Mediasis" width={438} height={130} className="h-auto w-[118px] object-contain group-data-[collapsible=icon]:w-8" priority />
        </div>
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:flex-col">
          <LocationSwitcher />
          <ModeToggle/>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        {billingLocked ? <p className="px-3 py-3 text-sm text-muted-foreground">Este negocio está pausado hasta confirmar el pago. Cambiá de negocio desde tu usuario.</p> : <>
        <NavProjects projects={visibleProjects} />
        {/* <NavSecondary items={data.navSecondary} className="mt-auto" /> */}
        {authorization.mode === "legacy" ? <NavMain items={data.navMain1} className="mt-auto"/> : null}
        {clerkSettings.length ? <NavMain label="Administración" items={clerkSettings} className="mt-auto" /> : null}
        </>}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/70 px-3 py-4">
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

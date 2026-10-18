"use client"

import { useEffect, useState } from "react"
import {
  ChevronRight,
  type LucideIcon,
} from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { usePathname } from "next/navigation"

type LeafItem = {
  name: string
  url: string
  icon: LucideIcon
}

type GroupItem = {
  title: string
  url?: string
  icon?: LucideIcon
  isActive?: boolean
  items: { title: string; url: string; showInSideBar?:boolean }[]
}

type ProjectEntry = LeafItem | GroupItem

export function NavProjects({
  projects,
}: {
  projects: ProjectEntry[]
}) {
  const pathname = usePathname();

  return (
    <SidebarGroup className="px-1">
      <SidebarGroupLabel className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">Gestiones</SidebarGroupLabel>
      <SidebarMenu className="gap-1.5">
        {projects.map((item) =>
          "items" in item ? (
            <ProjectGroup key={item.title} item={item} pathname={pathname} />
          ) : (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton asChild isActive={pathname === item.url} className="h-10 rounded-xl px-3 font-medium [&>svg]:text-muted-foreground data-[active=true]:[&>svg]:text-primary">
                <a href={item.url}>
                  <item.icon />
                  <span>{item.name}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        )}
        {/* <SidebarMenuItem>
          <SidebarMenuButton className="text-sidebar-foreground/70">
            <MoreHorizontal className="text-sidebar-foreground/70" />
            <span>More</span>
          </SidebarMenuButton>
        </SidebarMenuItem> */}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function ProjectGroup({ item, pathname }: { item: GroupItem; pathname: string }) {
  const isCurrentGroup = item.items.some((sub) => pathname === sub.url || pathname.startsWith(`${sub.url}/`))
  const [open, setOpen] = useState(isCurrentGroup)

  useEffect(() => {
    if (isCurrentGroup) setOpen(true)
  }, [pathname, isCurrentGroup])

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title} className="h-10 rounded-xl px-3 font-medium [&>svg]:text-muted-foreground">
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items.filter((sub) => sub.showInSideBar).map((sub) => {
              const active = pathname === sub.url || pathname.startsWith(`${sub.url}/`)
              return (
                <SidebarMenuSubItem key={sub.title}>
                  <SidebarMenuSubButton asChild isActive={active}>
                    <a href={sub.url}><span>{sub.title}</span></a>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

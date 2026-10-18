"use client";

import { useClerk, useOrganizationList } from "@clerk/nextjs";
import { Building2, Check, ChevronsUpDown, LogOut, Plus, Search, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/client";
import { resetPersistedLocation, useLocationStore } from "@/stores/location-store";
import { selectStaffBusiness } from "@/app/admin/staff-actions";

const initialsFor = (name: string) =>
  name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

const STAFF_BUSINESS_PAGE_SIZE = 50;
const normalizeSearchText = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();

export function NavUser() {
  const authorization = useDashboardAuthorization();
  return authorization.mode !== "legacy" ? (
    <ClerkNavUser />
  ) : (
    <LegacyNavUser />
  );
}

function UserButtonContent() {
  const { user } = useDashboardAuthorization();
  return (
    <>
      <Avatar>
        {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
        <AvatarFallback>{initialsFor(user.name)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs">{user.email}</span>
      </div>
      <ChevronsUpDown className="ml-auto size-4" />
    </>
  );
}

function LegacyNavUser() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const resetLocations = useLocationStore((state) => state.reset);

  const logout = async () => {
    await createClient().auth.signOut({ scope: "local" });
    resetLocations();
    resetPersistedLocation();
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <UserDropdownShell side={isMobile ? "bottom" : "right"}>
      <DropdownMenuItem onClick={logout}><LogOut />Cerrar sesión</DropdownMenuItem>
    </UserDropdownShell>
  );
}

function ClerkNavUser() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const authorization = useDashboardAuthorization();
  const { signOut, openUserProfile } = useClerk();
  const { setActive, isLoaded } = useOrganizationList();
  const resetLocations = useLocationStore((state) => state.reset);
  const [businessSearch, setBusinessSearch] = useState("");
  const [visibleStaffBusinesses, setVisibleStaffBusinesses] = useState(STAFF_BUSINESS_PAGE_SIZE);

  const filteredBusinesses = useMemo(() => {
    if (authorization.mode !== "staff") return authorization.businesses;
    const query = normalizeSearchText(businessSearch);
    if (!query) return authorization.businesses;
    return authorization.businesses.filter((business) =>
      normalizeSearchText(business.name).includes(query),
    );
  }, [authorization.businesses, authorization.mode, businessSearch]);

  const displayedBusinesses = authorization.mode === "staff"
    ? filteredBusinesses.slice(0, visibleStaffBusinesses)
    : filteredBusinesses;

  const switchBusiness = async (organizationId: string | null) => {
    if (!organizationId || !isLoaded) return;
    await setActive({ organization: organizationId });
    resetLocations();
    resetPersistedLocation();
    router.replace("/admin");
    router.refresh();
  };

  const switchStaffBusiness = async (businessId: string) => {
    await selectStaffBusiness(businessId);
    resetLocations();
    resetPersistedLocation();
    router.replace("/admin");
    router.refresh();
  };

  return (
    <UserDropdownShell side={isMobile ? "bottom" : "right"}>
      <DropdownMenuLabel>Negocios</DropdownMenuLabel>
      {authorization.mode === "staff" ? (
        <div className="relative px-2 pb-2" onKeyDown={(event) => event.stopPropagation()}>
          <Search className="pointer-events-none absolute left-4 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Buscar negocio"
            className="h-9 pl-8"
            placeholder="Buscar negocio..."
            value={businessSearch}
            onChange={(event) => {
              setBusinessSearch(event.target.value);
              setVisibleStaffBusinesses(STAFF_BUSINESS_PAGE_SIZE);
            }}
          />
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto">
        {displayedBusinesses.map((business) => (
          <DropdownMenuItem
            key={business.businessId}
            disabled={authorization.mode === "clerk" && !business.clerkOrganizationId}
            onClick={() => authorization.mode === "staff"
              ? switchStaffBusiness(business.businessId)
              : switchBusiness(business.clerkOrganizationId)}
          >
            <Building2 />
            <span className="min-w-0 flex-1 truncate">{business.name}</span>
            {business.businessId === authorization.activeBusinessId ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
        {displayedBusinesses.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No se encontraron negocios.</p>
        ) : null}
        {authorization.mode === "staff" && displayedBusinesses.length < filteredBusinesses.length ? (
          <DropdownMenuItem
            className="justify-center font-medium"
            onSelect={(event) => {
              event.preventDefault();
              setVisibleStaffBusinesses((current) => current + STAFF_BUSINESS_PAGE_SIZE);
            }}
          >
            Ver más
          </DropdownMenuItem>
        ) : null}
      </div>
      <DropdownMenuItem onClick={() => router.push("/admin/businesses/new")}>
        <Plus />Crear negocio
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => openUserProfile()}>
        <Settings />Administrar cuenta
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => router.push("/admin/account")}>
        <Settings />Accesos y negocios
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={async () => {
          resetLocations();
          resetPersistedLocation();
          await signOut({ redirectUrl: "/clerk-auth/sign-in" });
        }}
      >
        <LogOut />Cerrar sesión
      </DropdownMenuItem>
    </UserDropdownShell>
  );
}

function UserDropdownShell({
  children,
  side,
}: {
  children: React.ReactNode;
  side: "bottom" | "right";
}) {
  const { user } = useDashboardAuthorization();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="h-14 rounded-xl px-2.5 data-[state=open]:bg-sidebar-accent">
              <UserButtonContent />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg"
            side={side}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-2 py-1">
                <Avatar>
                  {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
                  <AvatarFallback>{initialsFor(user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

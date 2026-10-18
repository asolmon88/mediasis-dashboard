"use client";

import * as React from "react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MailPlus, MoreHorizontal, Plus, ShieldCheck, Smartphone, UsersRound } from "lucide-react";
import { toast } from "sonner";

import {
  archiveBusinessRole,
  cancelBusinessInvitation,
  changeBusinessMemberStatus,
  createOrderingAppUser,
  createReservedBusinessUser,
  inviteBusinessUser,
  saveBusinessRole,
  updateBusinessMember,
} from "@/app/admin/settings/users/actions";
import type { TeamActionResult, TeamManagementData, TeamMember, TeamRole } from "@/lib/dashboard/team-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type ProvisionMode = "invitation" | "reserved" | "ordering_app";

function hasPermission(data: TeamManagementData, key: string) {
  return data.actor_permissions.includes("*") || data.actor_permissions.includes(key);
}

function locationLabel(data: TeamManagementData, allLocations: boolean, ids: string[]) {
  if (allLocations) return "Todas las ubicaciones";
  const names = data.locations.filter((location) => ids.includes(location.location_id)).map((location) => location.name);
  return names.length ? names.join(", ") : "Sin ubicaciones";
}

function resultToast(result: TeamActionResult, success: string) {
  if (!result.success) {
    toast.error(result.message ?? "La operación no pudo completarse.");
    return false;
  }
  toast.success(result.message ?? success);
  if (result.warning) toast.warning(result.warning);
  return true;
}

export function TeamManagementPanel({ data }: { data: TeamManagementData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [provisionMode, setProvisionMode] = useState<ProvisionMode | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editingRole, setEditingRole] = useState<TeamRole | "new" | null>(null);
  const hasOrderingAppUser = data.members.some((member) => member.account_kind === "ordering_app");

  const run = (operation: () => Promise<TeamActionResult>, success: string, close?: () => void) => {
    startTransition(async () => {
      const result = await operation();
      if (resultToast(result, success)) {
        close?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        <p className="text-muted-foreground">Administrá quién puede entrar al negocio, su rol y sus ubicaciones.</p>
      </div>

      <Tabs defaultValue="users" className="gap-5">
        <TabsList>
          <TabsTrigger value="users"><UsersRound /> Usuarios</TabsTrigger>
          {hasPermission(data, "roles.read") ? <TabsTrigger value="roles"><ShieldCheck /> Roles</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="users" className="space-y-5">
          <div className="flex flex-wrap justify-end gap-2">
            {hasPermission(data, "members.invite") ? (
              <>
                <Button variant="outline" onClick={() => setProvisionMode("invitation")}><MailPlus /> Invitar usuario</Button>
                <Button onClick={() => setProvisionMode("reserved")}><KeyRound /> Crear usuario</Button>
                {!hasOrderingAppUser ? <Button variant="outline" onClick={() => setProvisionMode("ordering_app")}><Smartphone /> Crear usuario para App de pedidos</Button> : null}
              </>
            ) : null}
          </div>

          <section className="rounded-xl border bg-card">
            <div className="border-b p-5"><h2 className="font-semibold">Miembros</h2></div>
            <Table>
              <TableHeader><TableRow><TableHead>Usuario</TableHead><TableHead>Estado</TableHead><TableHead>Rol</TableHead><TableHead>Ubicaciones</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>
                {data.members.map((member) => (
                  <TableRow key={member.membership_id}>
                    <TableCell><div className="font-medium">{member.name}</div><div className="text-muted-foreground text-xs">{member.email ?? "Sin correo"}</div></TableCell>
                    <TableCell><Badge variant={member.status === "active" ? "default" : "secondary"}>{member.status === "active" ? "Activo" : "Suspendido"}</Badge></TableCell>
                    <TableCell>{member.role_name}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal">{locationLabel(data, member.all_locations, member.location_ids)}</TableCell>
                    <TableCell>
                      {member.account_kind === "business_member" && (hasPermission(data, "members.change_role") || hasPermission(data, "members.change_location_access") || hasPermission(data, "members.remove")) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Administrar ${member.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(hasPermission(data, "members.change_role") || hasPermission(data, "members.change_location_access")) ? <DropdownMenuItem onClick={() => setEditingMember(member)}>Editar acceso</DropdownMenuItem> : null}
                            {hasPermission(data, "members.remove") && member.status === "active" ? <DropdownMenuItem onClick={() => run(() => changeBusinessMemberStatus({ membershipId: member.membership_id, status: "suspended" }), "Usuario suspendido.")}>Suspender</DropdownMenuItem> : null}
                            {hasPermission(data, "members.remove") && member.status === "suspended" ? <DropdownMenuItem onClick={() => run(() => changeBusinessMemberStatus({ membershipId: member.membership_id, status: "active" }), "Usuario reactivado.")}>Reactivar</DropdownMenuItem> : null}
                            {hasPermission(data, "members.remove") ? <DropdownMenuItem className="text-destructive" onClick={() => run(() => changeBusinessMemberStatus({ membershipId: member.membership_id, status: "revoked" }), "Acceso al negocio eliminado.")}>Eliminar acceso</DropdownMenuItem> : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          {data.invitations.length ? (
            <section className="rounded-xl border bg-card">
              <div className="border-b p-5"><h2 className="font-semibold">Invitaciones y altas pendientes</h2></div>
              <Table><TableHeader><TableRow><TableHead>Correo</TableHead><TableHead>Tipo</TableHead><TableHead>Rol</TableHead><TableHead>Ubicaciones</TableHead><TableHead>Estado</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>{data.invitations.map((invitation) => <TableRow key={invitation.invitation_id}>
                  <TableCell>{invitation.email}</TableCell><TableCell>{invitation.mode === "reserved" ? "Creado directamente" : "Invitación"}</TableCell><TableCell>{invitation.role_name}</TableCell>
                  <TableCell className="max-w-64 whitespace-normal">{locationLabel(data, invitation.all_locations, invitation.location_ids)}</TableCell>
                  <TableCell><Badge variant={invitation.status === "failed" ? "destructive" : "secondary"}>{invitation.status === "failed" ? "Falló" : "Pendiente"}</Badge></TableCell>
                  <TableCell>{hasPermission(data, "members.invite") ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelBusinessInvitation(invitation.invitation_id), "Invitación cancelada.")}>Cancelar</Button> : null}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          {hasPermission(data, "roles.manage") ? <div className="flex justify-end"><Button onClick={() => setEditingRole("new")}><Plus /> Crear rol</Button></div> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {data.roles.map((role) => <section key={role.role_id} className="rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{role.name}</h2><p className="text-muted-foreground text-sm">{role.description ?? (role.role_key === "business_full_access" ? "Rol de administrador protegido por Mediasis." : "Sin descripción")}</p></div>{!role.editable ? <Badge>Protegido</Badge> : null}</div>
              <div className="mt-4 flex flex-wrap gap-2">{role.permission_keys.map((permission) => <Badge variant="secondary" key={permission}>{data.permissions.find((item) => item.key === permission)?.name ?? permission}</Badge>)}</div>
              {role.editable && hasPermission(data, "roles.manage") ? <div className="mt-5 flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditingRole(role)}>Editar</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => run(() => archiveBusinessRole(role.role_id), "Rol archivado.")}>Archivar</Button></div> : null}
            </section>)}
          </div>
        </TabsContent>
      </Tabs>

      <ProvisionDialog mode={provisionMode} data={data} pending={pending} onClose={() => setProvisionMode(null)} onSubmit={(operation, message) => run(operation, message, () => setProvisionMode(null))} />
      <MemberAccessDialog member={editingMember} data={data} pending={pending} onClose={() => setEditingMember(null)} onSubmit={(operation) => run(operation, "Acceso actualizado.", () => setEditingMember(null))} />
      <RoleDialog role={editingRole} data={data} pending={pending} onClose={() => setEditingRole(null)} onSubmit={(operation) => run(operation, "Rol guardado.", () => setEditingRole(null))} />
    </div>
  );
}

function ScopeFields({ data, roleId, setRoleId, allLocations, setAllLocations, locationIds, setLocationIds }: { data: TeamManagementData; roleId: string; setRoleId: (value: string) => void; allLocations: boolean; setAllLocations: (value: boolean) => void; locationIds: string[]; setLocationIds: (value: string[]) => void }) {
  const fullAccess = data.roles.find((role) => role.role_id === roleId)?.role_key === "business_full_access";
  return <>
    <div className="grid gap-2"><Label>Rol</Label><Select value={roleId} onValueChange={setRoleId}><SelectTrigger><SelectValue placeholder="Seleccioná un rol" /></SelectTrigger><SelectContent>{data.roles.map((role) => <SelectItem key={role.role_id} value={role.role_id}>{role.name}</SelectItem>)}</SelectContent></Select></div>
    <div className="flex items-center justify-between rounded-lg border p-3"><div><Label>Todas las ubicaciones</Label><p className="text-muted-foreground text-xs">{fullAccess ? "El acceso completo siempre incluye todas." : "Desactivá para elegir ubicaciones."}</p></div><Switch checked={fullAccess || allLocations} disabled={fullAccess} onCheckedChange={setAllLocations} /></div>
    {!fullAccess && !allLocations ? <div className="grid gap-2"><Label>Ubicaciones</Label>{data.locations.map((location) => <label className="flex items-center gap-2 text-sm" key={location.location_id}><Checkbox checked={locationIds.includes(location.location_id)} onCheckedChange={(checked) => setLocationIds(checked ? [...locationIds, location.location_id] : locationIds.filter((id) => id !== location.location_id))} />{location.name}</label>)}</div> : null}
  </>;
}

function ProvisionDialog({ mode, data, pending, onClose, onSubmit }: { mode: ProvisionMode | null; data: TeamManagementData; pending: boolean; onClose: () => void; onSubmit: (operation: () => Promise<TeamActionResult>, message: string) => void }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(data.roles[0]?.role_id ?? ""); const [allLocations, setAllLocations] = useState(true); const [locationIds, setLocationIds] = useState<string[]>([]);
  const correlationId = useMemo(() => crypto.randomUUID(), [mode]);
  const submit = () => {
    if (!mode) return;
    if (mode === "ordering_app") {
      onSubmit(() => createOrderingAppUser(), "Usuario para App de pedidos creado.");
      return;
    }
    const scope = { email, roleId, allLocations, locationIds, correlationId };
    onSubmit(() => mode === "invitation" ? inviteBusinessUser(scope) : createReservedBusinessUser({ ...scope, displayName: name, password }), mode === "invitation" ? "Invitación enviada." : "Usuario creado.");
  };
  const title = mode === "reserved" ? "Crear usuario" : mode === "ordering_app" ? "Crear usuario para App de pedidos" : "Invitar usuario";
  const description = mode === "reserved"
    ? "Definí el correo, la contraseña inicial y el acceso que tendrá este usuario."
    : mode === "ordering_app"
      ? "Crea el acceso de Supabase para la App de pedidos. El correo se generará desde el nombre del negocio y tendrá acceso completo a todas sus ubicaciones."
      : "Clerk enviará una invitación al correo indicado.";
  return <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    <div className="grid gap-4">{mode === "reserved" ? <div className="grid gap-2"><Label>Nombre</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div> : null}{mode !== "ordering_app" ? <><div className="grid gap-2"><Label>Correo</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>{mode === "reserved" ? <div className="grid gap-2"><Label>Contraseña inicial</Label><Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div> : null}<ScopeFields data={data} roleId={roleId} setRoleId={setRoleId} allLocations={allLocations} setAllLocations={setAllLocations} locationIds={locationIds} setLocationIds={setLocationIds} /></> : <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Este acceso no usa roles individuales ni Clerk. La App de pedidos lo trata como operador con acceso completo al negocio.</div>}</div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={pending} onClick={submit}>{pending ? "Guardando…" : mode === "reserved" ? "Crear usuario" : mode === "ordering_app" ? "Crear usuario para App de pedidos" : "Enviar invitación"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function MemberAccessDialog({ member, data, pending, onClose, onSubmit }: { member: TeamMember | null; data: TeamManagementData; pending: boolean; onClose: () => void; onSubmit: (operation: () => Promise<TeamActionResult>) => void }) {
  const [roleId, setRoleId] = useState(""); const [allLocations, setAllLocations] = useState(true); const [locationIds, setLocationIds] = useState<string[]>([]);
  React.useEffect(() => { if (member) { setRoleId(member.role_id); setAllLocations(member.all_locations); setLocationIds(member.location_ids); } }, [member]);
  return <Dialog open={Boolean(member)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Editar acceso</DialogTitle><DialogDescription>{member?.name}</DialogDescription></DialogHeader>{member ? <ScopeFields data={data} roleId={roleId} setRoleId={setRoleId} allLocations={allLocations} setAllLocations={setAllLocations} locationIds={locationIds} setLocationIds={setLocationIds} /> : null}<DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={pending} onClick={() => member && onSubmit(() => updateBusinessMember({ membershipId: member.membership_id, roleId, allLocations, locationIds }))}>Guardar</Button></DialogFooter></DialogContent></Dialog>;
}

function RoleDialog({ role, data, pending, onClose, onSubmit }: { role: TeamRole | "new" | null; data: TeamManagementData; pending: boolean; onClose: () => void; onSubmit: (operation: () => Promise<TeamActionResult>) => void }) {
  const existing = role && role !== "new" ? role : null; const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [permissionKeys, setPermissionKeys] = useState<string[]>([]); const idempotencyKey = useMemo(() => crypto.randomUUID(), [role]);
  React.useEffect(() => { setName(existing?.name ?? ""); setDescription(existing?.description ?? ""); setPermissionKeys(existing?.permission_keys ?? []); }, [existing]);
  return <Dialog open={role !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
      <DialogHeader className="shrink-0">
        <DialogTitle>{existing ? "Editar rol" : "Crear rol"}</DialogTitle>
        <DialogDescription>Solo podés asignar permisos que vos también tenés.</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1">
        <div className="grid gap-2"><Label>Nombre</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="grid gap-2"><Label>Descripción</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        <div className="grid gap-2"><Label>Permisos</Label>{data.permissions.filter((permission) => hasPermission(data, permission.key)).map((permission) => <label className="flex items-start gap-2 rounded-lg border p-3" key={permission.key}><Checkbox checked={permissionKeys.includes(permission.key)} onCheckedChange={(checked) => setPermissionKeys(checked ? [...permissionKeys, permission.key] : permissionKeys.filter((key) => key !== permission.key))} /><span><span className="block text-sm font-medium">{permission.name}</span><span className="text-muted-foreground text-xs">{permission.description}</span></span></label>)}</div>
      </div>
      <DialogFooter className="shrink-0 border-t pt-4">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={pending} onClick={() => onSubmit(() => saveBusinessRole({ roleId: existing?.role_id, idempotencyKey, name, description, permissionKeys }))}>Guardar rol</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

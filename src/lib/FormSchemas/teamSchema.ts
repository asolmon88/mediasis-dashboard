import { z } from "zod";

const locationScope = {
  roleId: z.string().uuid(),
  allLocations: z.boolean(),
  locationIds: z.array(z.string().uuid()),
};

export const InviteBusinessUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  correlationId: z.string().uuid(),
  ...locationScope,
}).superRefine((value, context) => {
  if (!value.allLocations && value.locationIds.length === 0) {
    context.addIssue({ code: "custom", path: ["locationIds"], message: "Seleccioná al menos una ubicación." });
  }
});

export const ReservedBusinessUserSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  correlationId: z.string().uuid(),
  ...locationScope,
}).superRefine((value, context) => {
  if (!value.allLocations && value.locationIds.length === 0) {
    context.addIssue({ code: "custom", path: ["locationIds"], message: "Seleccioná al menos una ubicación." });
  }
});

export const BusinessRoleSchema = z.object({
  roleId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300),
  permissionKeys: z.array(z.string()).min(1),
});

export const UpdateBusinessMemberSchema = z.object({
  membershipId: z.string().uuid(),
  roleId: z.string().uuid(),
  allLocations: z.boolean(),
  locationIds: z.array(z.string().uuid()),
}).superRefine((value, context) => {
  if (!value.allLocations && value.locationIds.length === 0) {
    context.addIssue({ code: "custom", path: ["locationIds"], message: "Seleccioná al menos una ubicación." });
  }
});

export const MemberStatusSchema = z.object({
  membershipId: z.string().uuid(),
  status: z.enum(["active", "suspended", "revoked"]),
});

export const InvitationIdSchema = z.string().uuid();
export const RoleIdSchema = z.string().uuid();

export type InviteBusinessUserInput = z.input<typeof InviteBusinessUserSchema>;
export type ReservedBusinessUserInput = z.input<typeof ReservedBusinessUserSchema>;
export type BusinessRoleInput = z.input<typeof BusinessRoleSchema>;
export type UpdateBusinessMemberInput = z.input<typeof UpdateBusinessMemberSchema>;
export type MemberStatusInput = z.input<typeof MemberStatusSchema>;

export type TeamPermission = {
  key: string;
  name: string;
  description: string | null;
};

export type TeamRole = {
  role_id: string;
  role_key: string;
  name: string;
  description: string | null;
  origin: "system" | "custom";
  editable: boolean;
  permission_keys: string[];
};

export type TeamMember = {
  account_kind: "business_member" | "ordering_app";
  membership_id: string;
  app_user_id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  status: "active" | "suspended";
  all_locations: boolean;
  clerk_membership_id: string | null;
  role_id: string;
  role_key: string;
  role_name: string;
  location_ids: string[];
  created_at: string;
};

export type TeamInvitation = {
  invitation_id: string;
  correlation_id: string;
  email: string;
  display_name: string | null;
  mode: "invitation" | "reserved";
  status: "pending" | "failed";
  role_id: string;
  role_name: string;
  all_locations: boolean;
  location_ids: string[];
  expires_at: string;
  last_error: string | null;
};

export type TeamManagementData = {
  success: true;
  members: TeamMember[];
  invitations: TeamInvitation[];
  roles: TeamRole[];
  permissions: TeamPermission[];
  actor_permissions: string[];
  locations: Array<{ location_id: string; name: string }>;
};

export type TeamActionResult = {
  success: boolean;
  message?: string;
  existingIdentity?: boolean;
  warning?: string;
};

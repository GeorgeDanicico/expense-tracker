import "server-only";

import type { Json } from "@/lib/database.types";
import {
  PARENT_PERMISSIONS,
  type CurrentMember,
  type FamilyData,
  type FamilyInvite,
  type FamilyMember,
  type FamilyRepository,
  type NewInvite,
} from "@/lib/family/repository";
import {
  FAMILY_ROLES,
  MODULE_KEYS,
  isLevelAllowed,
  normalizePermissions,
  type FamilyRole,
  type PermissionLevel,
  type Permissions,
} from "@/lib/permissions";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const MEMBERSHIP_ERROR = "Unable to load your family membership.";
const FAMILY_ERROR = "Unable to load the family.";
const CREATE_FAMILY_ERROR = "Unable to create the family.";
const SET_PERMISSIONS_ERROR = "Unable to save the permissions.";
const ADD_KID_ERROR = "Unable to add the kid to the family.";
const REMOVE_MEMBER_ERROR = "Unable to remove the member.";
const DELETE_FAMILY_ERROR = "Unable to delete the family.";
const TOUCH_ERROR = "Unable to record your last activity.";
const CREATE_INVITE_ERROR = "Unable to create the invite.";
const LIST_INVITES_ERROR = "Unable to load the invites.";
const REVOKE_INVITE_ERROR = "Unable to revoke the invite.";

/** `hashInviteCode`'s output. Anything else is a bug in the caller, never the user's fault. */
const CODE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** A member entry of `get_family()`; `lastActiveAt` and `permissions` are absent when hidden. */
type FamilyMemberJson = {
  memberId: string;
  userId: string;
  role: string;
  isCreator: boolean;
  displayName: string | null;
  username: string | null;
  joinedAt: string;
  lastActiveAt?: string | null;
  permissions?: Json;
};

type FamilyJson = {
  family: { id: string; name: string; createdAt: string };
  members: FamilyMemberJson[];
};

function toRole(value: string, fallback: string): FamilyRole {
  if ((FAMILY_ROLES as readonly string[]).includes(value)) return value as FamilyRole;
  throw new Error(fallback);
}

/**
 * The SQL sends `null` for a parent and every module for a kid. Parents become `PARENT_PERMISSIONS`;
 * a kid's levels outside the catalogue (or missing modules) become `off`, so a bad row never grants access.
 */
function toPermissions(role: FamilyRole, value: Json | undefined): Permissions {
  if (role === "parent") return PARENT_PERMISSIONS;
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowed = MODULE_KEYS.flatMap((module) => {
    const level = stored[module];
    return typeof level === "string" && isLevelAllowed(module, level as PermissionLevel) ? [[module, level]] : [];
  });
  return normalizePermissions(Object.fromEntries(allowed));
}

function toMember(member: FamilyMemberJson): FamilyMember {
  const role = toRole(member.role, FAMILY_ERROR);
  return {
    memberId: member.memberId,
    userId: member.userId,
    role,
    isCreator: member.isCreator,
    displayName: member.displayName,
    username: member.username,
    joinedAt: member.joinedAt,
    // Keep hidden fields absent rather than undefined-valued, so a missing key always means "hidden".
    ...("lastActiveAt" in member ? { lastActiveAt: member.lastActiveAt ?? null } : {}),
    ...("permissions" in member ? { permissions: toPermissions(role, member.permissions) } : {}),
  };
}

type InviteRow = {
  invite_id: string;
  role: string;
  permissions: Json | null;
  created_by_name: string | null;
  created_at: string;
  expires_at: string;
};

function toInvite(row: InviteRow): FamilyInvite {
  const role = toRole(row.role, LIST_INVITES_ERROR);
  return {
    inviteId: row.invite_id,
    role,
    permissions: role === "kid" ? toPermissions(role, row.permissions ?? undefined) : null,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** `FamilyRepository` on the family RPCs, which act as the request's caller. */
export const supabaseFamilyRepository: FamilyRepository = {
  async getMembership(): Promise<CurrentMember | null> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_my_membership");

    if (error) throw translateDatabaseError(error, MEMBERSHIP_ERROR);
    const row = data?.[0];
    if (!row) return null;

    const role = toRole(row.role, MEMBERSHIP_ERROR);
    return {
      memberId: row.member_id,
      familyId: row.family_id,
      familyName: row.family_name,
      role,
      isCreator: row.is_creator,
      permissions: toPermissions(role, row.permissions),
    };
  },

  async getFamily(): Promise<FamilyData | null> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_family");

    if (error) throw translateDatabaseError(error, FAMILY_ERROR);
    if (!data) return null;

    const { family, members } = data as unknown as FamilyJson;
    return {
      family: { id: family.id, name: family.name, createdAt: family.createdAt },
      members: members.map(toMember),
    };
  },

  async createFamily(name: string): Promise<string> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_family", { p_name: name });

    if (error) throw translateDatabaseError(error, CREATE_FAMILY_ERROR);
    if (!data) throw new Error(CREATE_FAMILY_ERROR);
    return data;
  },

  async setMemberPermissions(memberId: string, permissions: Permissions): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_member_permissions", {
      p_member_id: memberId,
      p_permissions: permissions,
    });

    if (error) throw translateDatabaseError(error, SET_PERMISSIONS_ERROR);
  },

  async addManagedKid(userId: string, permissions: Permissions): Promise<string> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_managed_kid", {
      p_user_id: userId,
      p_permissions: permissions,
    });

    if (error) throw translateDatabaseError(error, ADD_KID_ERROR);
    if (!data) throw new Error(ADD_KID_ERROR);
    return data;
  },

  async removeMember(memberId: string): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_family_member", { p_member_id: memberId });

    if (error) throw translateDatabaseError(error, REMOVE_MEMBER_ERROR);
  },

  async deleteFamily(confirmName: string): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_family", { p_confirm_name: confirmName });

    if (error) throw translateDatabaseError(error, DELETE_FAMILY_ERROR);
  },

  async touchLastActive(): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("touch_last_active");

    if (error) throw translateDatabaseError(error, TOUCH_ERROR);
  },

  async createInvite({ role, permissions, codeHash }: NewInvite) {
    // The database would refuse a malformed hash with a 422 meant for users; it is a server bug, so fail as one.
    if (!CODE_HASH_PATTERN.test(codeHash)) throw new Error(CREATE_INVITE_ERROR);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_family_invite", {
      p_role: role,
      p_permissions: permissions,
      p_code_hash: codeHash,
    });

    if (error) throw translateDatabaseError(error, CREATE_INVITE_ERROR);
    const row = data?.[0];
    if (!row) throw new Error(CREATE_INVITE_ERROR);
    return { inviteId: row.invite_id, expiresAt: row.expires_at };
  },

  async listInvites(): Promise<FamilyInvite[]> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_family_invites");

    if (error) throw translateDatabaseError(error, LIST_INVITES_ERROR);
    return (data ?? []).map(toInvite);
  },

  async revokeInvite(inviteId: string): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_family_invite", { p_invite_id: inviteId });

    if (error) throw translateDatabaseError(error, REVOKE_INVITE_ERROR);
  },
};

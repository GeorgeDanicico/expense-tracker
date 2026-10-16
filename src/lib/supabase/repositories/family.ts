import "server-only";

import type { Json } from "@/lib/database.types";
import {
  PARENT_PERMISSIONS,
  type CurrentMember,
  type FamilyData,
  type FamilyMember,
  type FamilyRepository,
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
const TOUCH_ERROR = "Unable to record your last activity.";

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

  async touchLastActive(): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("touch_last_active");

    if (error) throw translateDatabaseError(error, TOUCH_ERROR);
  },
};

import { z } from "zod";

import { FAMILY_ROLES, MODULE_LABELS, MODULE_LEVELS, type ModuleKey, type Permissions } from "@/lib/permissions";
import { passwordSchema } from "@/lib/validation/primitives";

const moduleLevel = <M extends ModuleKey>(module: M) =>
  z.enum(MODULE_LEVELS[module], `Choose an allowed level for ${MODULE_LABELS[module]}.`);

/** Every module with a level it allows; unknown modules are rejected. */
export const permissionsSchema = z.strictObject(
  {
    expenses: moduleLevel("expenses"),
    investments: moduleLevel("investments"),
    net_worth: moduleLevel("net_worth"),
    family_finance: moduleLevel("family_finance"),
  } satisfies Record<ModuleKey, z.ZodType>,
  "Permissions may only list known modules.",
);

export const familyNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a family name.")
  .max(60, "Use at most 60 characters.");

/** The body of `POST /api/family`. */
export const createFamilySchema = z.object({ name: familyNameSchema });

const CONFIRM_NAME_MESSAGE = "Type the family's name to confirm.";

/** The body of `DELETE /api/family`: the family's name, typed to confirm. The database compares it ignoring case. */
export const deleteFamilySchema = z.object({
  confirmName: z.string(CONFIRM_NAME_MESSAGE).trim().min(1, CONFIRM_NAME_MESSAGE),
});

/** The body of `PATCH /api/family/members/[id]/permissions`. */
export const memberPermissionsSchema = z.object({ permissions: permissionsSchema });

/** Lowercase; starts with a letter or digit, then letters, digits, dots, underscores or hyphens; 3–30 characters. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, "Use 3–30 letters, numbers, dots, underscores or hyphens, starting with a letter or number.");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(40, "Use at most 40 characters.");

/** The body of `POST /api/family/kids`: the new kid account and the kid's permissions. */
export const createKidSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  permissions: permissionsSchema,
});

/** No 0, O, 1, I or L, so codes are easy to read aloud and type. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

const INVITE_CODE_PATTERN = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** Uppercases a typed code and removes spaces and dashes before matching. */
export function normalizeInviteCode(code: string) {
  return code.toUpperCase().replace(/[\s-]+/g, "");
}

export const inviteCodeSchema = z
  .string()
  .transform(normalizeInviteCode)
  .refine((code) => INVITE_CODE_PATTERN.test(code), "Enter the 8-character invite code.");

/** An invite's role and, for a kid, permissions: what `POST /api/family/invites` stores. */
export type InviteRequest = { role: "parent"; permissions: null } | { role: "kid"; permissions: Permissions };

/**
 * The body of `POST /api/family/invites`: `{ role, permissions? }`. A kid invite needs every module's
 * level; a parent invite has none (missing or null), because parents always have full access.
 */
export const createInviteSchema = z
  .object({
    role: z.enum(FAMILY_ROLES, "Choose whether to invite a parent or a kid."),
    permissions: permissionsSchema.nullish(),
  })
  .superRefine(({ role, permissions }, context) => {
    if (role === "kid" && !permissions) {
      context.addIssue({ code: "custom", path: ["permissions"], message: "Choose what the kid can use." });
    }
    if (role === "parent" && permissions) {
      context.addIssue({ code: "custom", path: ["permissions"], message: "Parents always have full access." });
    }
  })
  .transform(({ role, permissions }): InviteRequest =>
    role === "kid" ? { role, permissions: permissions as Permissions } : { role, permissions: null },
  );

/** The body of `POST /api/family/join/preview` and `POST /api/family/join`: `{ code }`, normalized. */
export const joinFamilySchema = z.object({
  code: z.string("Enter the 8-character invite code.").pipe(inviteCodeSchema),
});

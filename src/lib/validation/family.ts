import { z } from "zod";

import { MODULE_LABELS, MODULE_LEVELS, type ModuleKey } from "@/lib/permissions";

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

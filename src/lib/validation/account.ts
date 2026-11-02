import { z } from "zod";

import { DELETE_ACCOUNT_PHRASE, DELETION_REFUSALS } from "@/lib/account/data-repository";
import { KID_EMAIL_DOMAIN } from "@/lib/family/kid-account";
import { currentPasswordSchema } from "@/lib/validation/password";

/**
 * The body of `PATCH /api/account/email`: a real address, never a generated kid address, and the
 * current password (re-authentication).
 */
export const changeEmailSchema = z.object({
  email: z
    .string("Enter a valid email address.")
    .trim()
    .pipe(z.email("Enter a valid email address."))
    .refine((value) => !value.toLowerCase().endsWith(`@${KID_EMAIL_DOMAIN}`), "Enter a valid email address."),
  currentPassword: currentPasswordSchema,
});

/**
 * The body of `DELETE /api/account`: the current password (re-authentication) and the typed phrase
 * "delete my account", ignoring case and surrounding spaces. The database checks the phrase again.
 */
export const deleteAccountSchema = z.object({
  currentPassword: currentPasswordSchema,
  confirm: z
    .string(DELETION_REFUSALS.phrase)
    .trim()
    .refine((value) => value.toLowerCase() === DELETE_ACCOUNT_PHRASE, DELETION_REFUSALS.phrase),
});

/**
 * The body of `DELETE /api/family/members/[id]/account`: the parent's own current password and the
 * kid's name, typed to confirm. The database compares the name, ignoring case.
 */
export const deleteKidAccountSchema = z.object({
  currentPassword: currentPasswordSchema,
  confirmName: z.string(DELETION_REFUSALS.kidName).trim().min(1, DELETION_REFUSALS.kidName).max(100, DELETION_REFUSALS.kidName),
});

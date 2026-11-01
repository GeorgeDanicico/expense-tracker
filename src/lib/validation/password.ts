import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** A new password: the sign-in rule, 8–128 characters. */
export const passwordSchema = z
  .string("Enter a password.")
  .min(PASSWORD_MIN_LENGTH, `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must contain at most ${PASSWORD_MAX_LENGTH} characters.`);

/**
 * The password the user signs in with today, asked for again before their password or email
 * changes (re-authentication). Only its presence and the sign-in maximum are checked here; the auth
 * provider decides whether it's right.
 */
export const currentPasswordSchema = z
  .string("Enter your current password.")
  .min(1, "Enter your current password.")
  .max(PASSWORD_MAX_LENGTH, "That isn't your current password.");

/**
 * The body of `POST /api/account/password`: the current password (for a kid who must change theirs,
 * the temporary one they just signed in with) and the new one. The confirmation field is checked in
 * the browser.
 */
export const changePasswordSchema = z.object({ currentPassword: currentPasswordSchema, password: passwordSchema });

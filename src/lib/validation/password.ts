import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** A new password: the sign-in rule, 8–128 characters. */
export const passwordSchema = z
  .string("Enter a password.")
  .min(PASSWORD_MIN_LENGTH, `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must contain at most ${PASSWORD_MAX_LENGTH} characters.`);

/** The body of `POST /api/account/password`. The confirmation field is checked in the browser. */
export const changePasswordSchema = z.object({ password: passwordSchema });

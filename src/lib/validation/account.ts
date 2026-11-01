import { z } from "zod";

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

import { WRONG_CURRENT_PASSWORD } from "@/lib/account/password-change";
import { getAuth } from "@/lib/auth";
import { passwordChangeAttempts, TOO_MANY_PASSWORD_CHANGES } from "@/lib/http/rate-limit";
import { HttpError, noContent, parseBody, tooManyRequests, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { changePasswordSchema } from "@/lib/validation/password";

const INVALID = "Check the highlighted details and try again.";

/**
 * Sets a new password for the signed-in user, then clears their "must change password" flag and
 * signs out every other session they have (audit P5). Open to an account that must change its
 * password (`allowPasswordChangeRequired`): this is where it does.
 *
 * The current password is asked for first (re-authentication), also from a kid who must change a
 * temporary one: they just signed in with it. A wrong one is a 422 on `currentPassword` and counts
 * toward the same limit as every other attempt: 429 past `PASSWORD_CHANGE_MAX_ATTEMPTS` an hour.
 *
 * The flag lives in `profiles`, so the user's own session clears it; when the provider refuses the
 * new password, the flag stays set.
 */
export const POST = withUser(async (request, user) => {
  const wait = passwordChangeAttempts.retryAfterSeconds(user.id);
  if (wait > 0) return tooManyRequests(TOO_MANY_PASSWORD_CHANGES, wait);

  const { currentPassword, password } = await parseBody(request, changePasswordSchema, INVALID);
  passwordChangeAttempts.recordAttempt(user.id);

  const auth = getAuth();
  const verified = await auth.verifyPassword(user.email, currentPassword);
  if (!verified.ok) {
    if (verified.kind === "invalid_credentials") throw new HttpError(422, INVALID, { currentPassword: [WRONG_CURRENT_PASSWORD] });
    throw new HttpError(verified.kind === "rate_limited" ? 429 : 400, verified.reason);
  }

  const updated = await auth.updatePassword(password);
  if (!updated.ok) throw new HttpError(updated.kind === "rate_limited" ? 429 : 400, updated.reason);

  await getRepositories().account.completePasswordChange();

  // The password has changed: a failure here mustn't read as if it hadn't. Supabase Auth also ends
  // the other sessions itself on a password change; this makes sure of it.
  const others = await auth.signOut("others");
  if (!others.ok) console.error("Password changed, but the other sessions could not be signed out.");

  return noContent();
}, { failure: "Unable to change your password. Please try again.", allowPasswordChangeRequired: true });

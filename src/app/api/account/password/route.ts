import { getAuth } from "@/lib/auth";
import { passwordChangeAttempts, TOO_MANY_PASSWORD_CHANGES } from "@/lib/http/rate-limit";
import { HttpError, noContent, parseBody, tooManyRequests, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { changePasswordSchema } from "@/lib/validation/password";

/**
 * Sets a new password for the signed-in user, then clears their "must change password" flag.
 * The flag lives in `profiles`, so the user's own session clears it; when the provider refuses the
 * password, the flag stays set. 429 past `PASSWORD_CHANGE_MAX_ATTEMPTS` attempts an hour.
 */
export const POST = withUser(async (request, user) => {
  const wait = passwordChangeAttempts.retryAfterSeconds(user.id);
  if (wait > 0) return tooManyRequests(TOO_MANY_PASSWORD_CHANGES, wait);

  const { password } = await parseBody(request, changePasswordSchema, "Check the highlighted details and try again.");
  passwordChangeAttempts.recordAttempt(user.id);

  const updated = await getAuth().updatePassword(password);
  if (!updated.ok) throw new HttpError(updated.kind === "rate_limited" ? 429 : 400, updated.reason);

  await getRepositories().account.completePasswordChange();
  return noContent();
}, { failure: "Unable to change your password. Please try again." });

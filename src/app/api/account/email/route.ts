import type { NextRequest } from "next/server";

import { WRONG_CURRENT_PASSWORD } from "@/lib/account/password-change";
import { getAuth } from "@/lib/auth";
import { siteOrigin } from "@/lib/http/origin";
import { emailChangeAttempts, TOO_MANY_EMAIL_CHANGES } from "@/lib/http/rate-limit";
import { HttpError, noContent, parseBody, tooManyRequests, withUser } from "@/lib/http/route";
import { changeEmailSchema } from "@/lib/validation/account";

const INVALID = "Check the highlighted details and try again.";

/**
 * Asks the auth provider to change the signed-in user's email, after checking their current password
 * (re-authentication, audit P5). The change takes effect once the link sent to the new address is
 * opened; it comes back through `/auth/confirm` to the settings page.
 *
 * A wrong current password is a 422 on `currentPassword`. Every attempt counts, wrong passwords
 * included: 429 past `EMAIL_CHANGE_MAX_ATTEMPTS` an hour.
 */
export const PATCH = withUser(async (request: NextRequest, user) => {
  const wait = emailChangeAttempts.retryAfterSeconds(user.id);
  if (wait > 0) return tooManyRequests(TOO_MANY_EMAIL_CHANGES, wait);

  const { email, currentPassword } = await parseBody(request, changeEmailSchema, INVALID);
  emailChangeAttempts.recordAttempt(user.id);

  const auth = getAuth();
  const verified = await auth.verifyPassword(user.email, currentPassword);
  if (!verified.ok) {
    if (verified.kind === "invalid_credentials") throw new HttpError(422, INVALID, { currentPassword: [WRONG_CURRENT_PASSWORD] });
    throw new HttpError(verified.kind === "rate_limited" ? 429 : 400, verified.reason);
  }

  const confirmationUrl = new URL("/auth/confirm", siteOrigin(request));
  confirmationUrl.searchParams.set("next", "/settings");

  const updated = await auth.updateEmail(email, confirmationUrl.toString());
  if (!updated.ok) throw new HttpError(updated.kind === "rate_limited" ? 429 : 400, updated.reason);

  return noContent();
}, { failure: "Unable to change your email. Please try again." });

import type { NextRequest } from "next/server";

import { getAuth } from "@/lib/auth";
import { siteOrigin } from "@/lib/http/origin";
import { emailChangeAttempts, TOO_MANY_EMAIL_CHANGES } from "@/lib/http/rate-limit";
import { HttpError, noContent, parseBody, tooManyRequests, withUser } from "@/lib/http/route";
import { changeEmailSchema } from "@/lib/validation/account";

/**
 * Asks the auth provider to change the signed-in user's email. The change takes effect once the
 * link sent to the new address is opened; it comes back through `/auth/confirm` to the settings page.
 * 429 past `EMAIL_CHANGE_MAX_ATTEMPTS` attempts an hour.
 */
export const PATCH = withUser(async (request: NextRequest, user) => {
  const wait = emailChangeAttempts.retryAfterSeconds(user.id);
  if (wait > 0) return tooManyRequests(TOO_MANY_EMAIL_CHANGES, wait);

  const { email } = await parseBody(request, changeEmailSchema, "Enter a valid email address.");
  emailChangeAttempts.recordAttempt(user.id);

  const confirmationUrl = new URL("/auth/confirm", siteOrigin(request));
  confirmationUrl.searchParams.set("next", "/settings");

  const updated = await getAuth().updateEmail(email, confirmationUrl.toString());
  if (!updated.ok) throw new HttpError(updated.kind === "rate_limited" ? 429 : 400, updated.reason);

  return noContent();
}, { failure: "Unable to change your email. Please try again." });

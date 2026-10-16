import type { NextRequest } from "next/server";

import { getAuth } from "@/lib/auth";
import { siteOrigin } from "@/lib/http/origin";
import { HttpError, noContent, parseBody, withUser } from "@/lib/http/route";
import { changeEmailSchema } from "@/lib/validation/account";

/**
 * Asks the auth provider to change the signed-in user's email. The change takes effect once the
 * link sent to the new address is opened; it comes back through `/auth/confirm` to the settings page.
 */
export const PATCH = withUser(async (request: NextRequest) => {
  const { email } = await parseBody(request, changeEmailSchema, "Enter a valid email address.");

  const confirmationUrl = new URL("/auth/confirm", siteOrigin(request));
  confirmationUrl.searchParams.set("next", "/settings");

  const updated = await getAuth().updateEmail(email, confirmationUrl.toString());
  if (!updated.ok) throw new HttpError(400, updated.reason);

  return noContent();
}, { failure: "Unable to change your email. Please try again." });

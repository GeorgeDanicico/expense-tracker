import { CHANGE_PASSWORD_PATH, PASSWORD_CHANGE_REQUIRED } from "@/lib/account/password-change";
import { ApiError } from "@/lib/api/client";

/** Whether an API error is the 403 an account that must choose a new password gets (audit P4). */
export function isPasswordChangeRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === PASSWORD_CHANGE_REQUIRED;
}

/**
 * Sends the browser to the change-password page when a read was refused because the account must
 * choose a new password first: a parent reset the kid's password while the app was open. The `(app)`
 * layout does the same from the account's flag; this catches every other screen's requests. Returns
 * whether it redirected. A write's form shows the refusal's message instead.
 */
export function redirectIfPasswordChangeRequired(
  error: unknown,
  location: Pick<Location, "pathname" | "replace"> | undefined = typeof window === "undefined" ? undefined : window.location,
): boolean {
  if (!location || !isPasswordChangeRequired(error) || location.pathname === CHANGE_PASSWORD_PATH) return false;
  location.replace(CHANGE_PASSWORD_PATH);
  return true;
}

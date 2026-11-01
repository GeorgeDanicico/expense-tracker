import { ApiError, apiRequest } from "@/lib/api/client";
import { ACCOUNT_EMAIL_API_URL, ACCOUNT_PASSWORD_API_URL, SIGN_OUT_API_URL, SIGN_OUT_EVERYWHERE_API_URL } from "@/lib/api/keys";

/**
 * The requests behind the account forms (Settings → Account and the change-password page), kept out
 * of the components so tests can call them directly. Each throws an `ApiError` the form shows.
 */

export type PasswordChange = { currentPassword: string; password: string; confirmPassword: string };

/**
 * Changes the signed-in user's password. The two new passwords must match, checked here before any
 * request. The server checks the current one and signs every other session out.
 */
export async function changePassword({ currentPassword, password, confirmPassword }: PasswordChange) {
  if (password !== confirmPassword) {
    throw new ApiError("Check the highlighted details and try again.", 422, {
      confirmPassword: ["The passwords don't match."],
    });
  }
  await apiRequest<void>(ACCOUNT_PASSWORD_API_URL, { method: "POST", body: JSON.stringify({ currentPassword, password }) });
}

/** Asks to change the signed-in user's email; the server checks the current password first. */
export async function changeEmail({ email, currentPassword }: { email: string; currentPassword: string }) {
  await apiRequest<void>(ACCOUNT_EMAIL_API_URL, { method: "PATCH", body: JSON.stringify({ email, currentPassword }) });
}

/** Signs this browser out. */
export async function signOut() {
  await apiRequest<{ success: true }>(SIGN_OUT_API_URL, { method: "DELETE" });
}

/** Signs every session of the account out: other browsers, phones and connected apps, and this one. */
export async function signOutEverywhere() {
  await apiRequest<{ success: true }>(SIGN_OUT_EVERYWHERE_API_URL, { method: "DELETE" });
}

import { ApiError, apiRequest } from "@/lib/api/client";
import {
  ACCOUNT_API_KEY,
  ACCOUNT_EMAIL_API_URL,
  ACCOUNT_EXPORT_API_URL,
  ACCOUNT_PASSWORD_API_URL,
  SIGN_OUT_API_URL,
  SIGN_OUT_EVERYWHERE_API_URL,
} from "@/lib/api/keys";

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

/**
 * Deletes the signed-in user's account and everything in it. The server checks the password, the
 * typed phrase and the family rules, and signs this browser out.
 */
export async function deleteAccount({ currentPassword, confirm }: { currentPassword: string; confirm: string }) {
  await apiRequest<void>(ACCOUNT_API_KEY, { method: "DELETE", body: JSON.stringify({ currentPassword, confirm }) });
}

/** An export can take a while for a big account; far longer than an ordinary request's timeout. */
const EXPORT_TIMEOUT_MS = 120_000;

/**
 * Downloads everything the signed-in user owns as a ZIP, and returns it with the file name the server
 * chose. Throws an `ApiError` with the server's message when it refuses (for example 429), and a
 * generic one when the download breaks off.
 */
export async function downloadMyData(): Promise<{ blob: Blob; fileName: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    const response = await fetch(ACCOUNT_EXPORT_API_URL, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(payload.error || "Unable to download your data. Please try again.", response.status);
    }
    const fileName = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "my-data.zip";
    return { blob: await response.blob(), fileName };
  } catch (caught) {
    if (caught instanceof ApiError) throw caught;
    throw new ApiError("Unable to download your data. Check your connection and try again.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

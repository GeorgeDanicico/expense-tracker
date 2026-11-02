import "server-only";

import { WRONG_CURRENT_PASSWORD } from "@/lib/account/password-change";
import { getAuth, getAuthAdmin, type AuthenticatedUser } from "@/lib/auth";
import { HttpError } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { getRepositories } from "@/lib/repositories";

/** The 422 message for a deletion form with a wrong field (the password, or a confirmation the browser let through). */
export const DELETE_INVALID = "Check the highlighted details and try again.";

/**
 * Re-authentication before a deletion (audit P5, as for password and email changes): a wrong
 * password is a 422 on `currentPassword`; the provider's rate limit a 429.
 */
async function requireCurrentPassword(user: AuthenticatedUser, currentPassword: string) {
  const verified = await getAuth().verifyPassword(user.email, currentPassword);
  if (verified.ok) return;
  if (verified.kind === "invalid_credentials") throw new HttpError(422, DELETE_INVALID, { currentPassword: [WRONG_CURRENT_PASSWORD] });
  throw new HttpError(verified.kind === "rate_limited" ? 429 : 400, verified.reason);
}

/**
 * Deletes the signed-in user's account (security plan S13), in this order, so a failure at any step
 * leaves something the user can retry:
 *
 * 1. Their current password is checked. Nothing has changed yet.
 * 2. `delete_my_data()` deletes everything they own in one transaction, after checking the family
 *    rules (a creator deletes the family first, a member is removed from it first, a kid account a
 *    family manages is deleted by a parent) and the typed phrase. A refusal or a failure changes
 *    nothing. Without S13's migration the RPC is unknown, so this fails with a 500 and nothing is
 *    deleted.
 * 3. The admin API deletes their avatar files, then the auth user. That ends every session, refresh
 *    token and connected app of the account in the auth provider, and cascades to the profile. If it
 *    fails, the user is still signed in with nothing left in the app; deleting again does step 2 as a
 *    no-op and retries this one.
 * 4. This browser's session cookies are cleared. The provider has already ended the session, so a
 *    failure here is only logged.
 */
export async function deleteOwnAccount(user: AuthenticatedUser, input: { currentPassword: string; confirm: string }): Promise<void> {
  await requireCurrentPassword(user, input.currentPassword);
  await getRepositories().accountData.deleteMyData(input.confirm);
  await getAuthAdmin().deleteUser(user.id);

  const signedOut = await getAuth().signOut("local");
  if (!signedOut.ok) log.error("account_deleted_cookie_clear_failed", { userId: user.id, reason: signedOut.reason });
}

/**
 * A parent deletes a kid account made for their family, from Manage family (security plan S13). The
 * caller is a parent (`withParent` checked); the database checks it again, and that the member is a
 * kid account made for this family, in step 2. The same order as `deleteOwnAccount`:
 *
 * 1. The parent's own current password is checked.
 * 2. `delete_managed_kid_data()` deletes everything the kid owns in one transaction and returns the
 *    kid's user id. The kid stays in the family until step 3, so if step 3 fails, the parent sees an
 *    error and can delete again from Manage family.
 * 3. The admin API deletes the kid's avatar files and the auth user: every session of the kid ends,
 *    and the membership and the profile go with it.
 */
export async function deleteManagedKidAccount(
  parent: AuthenticatedUser,
  memberId: string,
  input: { currentPassword: string; confirmName: string },
): Promise<void> {
  await requireCurrentPassword(parent, input.currentPassword);
  const kidUserId = await getRepositories().accountData.deleteManagedKidData(memberId, input.confirmName);
  // Only after the database proved the caller may delete this kid: the admin client ignores every rule.
  await getAuthAdmin().deleteUser(kidUserId);
}

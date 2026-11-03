import "server-only";

import { getAuthAdmin } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { kidAccountEmail } from "@/lib/family/kid-account";
import type { CurrentMember } from "@/lib/family/repository";
import { errorFields, log } from "@/lib/log";
import { getRepositories } from "@/lib/repositories";
import { createKidSchema } from "@/lib/validation/family";
import { fieldErrorsOf } from "@/lib/validation/field-errors";

export type CreatedKid = {
  /** The new account's user id. */
  userId: string;
  /** The kid's membership in the caller's family. */
  memberId: string;
};

const INVALID_KID = "Check the kid's details and try again.";

/**
 * Creates a kid account for `parent`'s family and adds it as a kid with the given permissions.
 * `parent` is the caller's membership, already checked to be a parent by the route's `withParent`
 * (src/lib/http/permission.ts). `input` is the request body: `{ displayName, username, password,
 * permissions }`.
 *
 * Steps, in order: the input must be valid (422); the username must be free (409 "That username is
 * taken."); the account is created, confirmed, marked for the parent's family and required to choose
 * a new password, with the generated email `<username>@kids.ifam.invalid`; then it joins the family
 * **as the parent**, so `add_managed_kid` checks the caller again. If that last step fails, the new
 * account is deleted and the original error is thrown.
 */
export async function createKidAccount(parent: CurrentMember, input: unknown): Promise<CreatedKid> {
  const parsed = createKidSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(INVALID_KID, 422, fieldErrorsOf(parsed.error));
  const { displayName, username, password, permissions } = parsed.data;

  // Only after the route's parent check: the admin client bypasses every database rule.
  const admin = getAuthAdmin();
  if ((await admin.findEmailByUsername(username)) !== null) {
    throw new DomainError("That username is taken.", 409);
  }

  const user = await admin.createUser({
    email: kidAccountEmail(username),
    password,
    username,
    displayName,
    managedByFamily: parent.familyId,
    mustChangePassword: true,
  });

  try {
    const memberId = await getRepositories().family.addManagedKid(user.id, permissions);
    return { userId: user.id, memberId };
  } catch (error) {
    // Don't leave an account behind that no family can see.
    try {
      await admin.deleteUser(user.id);
    } catch (cleanupError) {
      log.error("kid_account_cleanup_failed", { userId: user.id, ...errorFields(cleanupError) });
    }
    throw error;
  }
}

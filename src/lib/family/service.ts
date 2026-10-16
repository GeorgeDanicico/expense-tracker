import "server-only";

import type { z } from "zod";

import { getAuthAdmin } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { getCurrentMember } from "@/lib/family/current-member";
import { kidAccountEmail } from "@/lib/family/kid-account";
import { getRepositories } from "@/lib/repositories";
import { createKidSchema } from "@/lib/validation/family";

export type CreatedKid = {
  /** The new account's user id. */
  userId: string;
  /** The kid's membership in the caller's family. */
  memberId: string;
};

const INVALID_KID = "Check the kid's details and try again.";

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const entries = Object.entries(error.flatten().fieldErrors as Record<string, string[] | undefined>);
  return Object.fromEntries(entries.filter((entry): entry is [string, string[]] => entry[1] !== undefined));
}

/**
 * Creates a kid account for the caller's family and adds it as a kid with the given permissions.
 * For parents only. `input` is the request body: `{ displayName, username, password, permissions }`.
 *
 * Steps, in order: the caller must be a parent (403); the input must be valid (422); the username
 * must be free (409 "That username is taken."); the account is created, confirmed, marked for the
 * caller's family and required to choose a new password, with the generated email
 * `<username>@kids.ifam.invalid`; then it joins the family **as the parent**, so `add_managed_kid`
 * checks the caller again. If that last step fails, the new account is deleted and the original
 * error is thrown.
 */
export async function createKidAccount(input: unknown): Promise<CreatedKid> {
  const caller = await getCurrentMember();
  if (caller?.role !== "parent") throw new DomainError("Only parents can add a kid.", 403);

  const parsed = createKidSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(INVALID_KID, 422, fieldErrors(parsed.error));
  const { displayName, username, password, permissions } = parsed.data;

  // Only now, after the permission check: the admin client bypasses every database rule.
  const admin = getAuthAdmin();
  if ((await admin.findEmailByUsername(username)) !== null) {
    throw new DomainError("That username is taken.", 409);
  }

  const user = await admin.createUser({
    email: kidAccountEmail(username),
    password,
    username,
    displayName,
    managedByFamily: caller.familyId,
    mustChangePassword: true,
  });

  try {
    const memberId = await getRepositories().family.addManagedKid(user.id, permissions);
    return { userId: user.id, memberId };
  } catch (error) {
    // Don't leave an account behind that no family can see.
    try {
      await admin.deleteUser(user.id);
    } catch {
      console.error(`createKidAccount: could not delete account ${user.id} after adding it to the family failed.`);
    }
    throw error;
  }
}

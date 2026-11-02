import { getAuthAdmin } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { withParent } from "@/lib/http/permission";
import { json, parseBody, parseId } from "@/lib/http/route";
import { errorFields, log } from "@/lib/log";
import { getRepositories } from "@/lib/repositories";
import { resetKidPasswordSchema } from "@/lib/validation/family";

const FAILURE = "Unable to reset the password.";

/**
 * The kid's account behind `memberId`, if the parent may reset its password: the member is a kid of
 * their family. Read as the caller, under RLS, with the same refusals and messages as
 * `require_password_change()`, which checks it all again in step 2. (`withParent` already refused
 * anyone who isn't a parent.)
 */
async function kidUserIdToReset(memberId: string): Promise<string> {
  const target = (await getRepositories().family.getFamily())?.members.find((candidate) => candidate.memberId === memberId);
  if (!target) throw new DomainError("That family member wasn't found.", 404);
  if (target.role !== "kid") throw new DomainError("Only a kid's password can be reset.", 403);
  return target.userId;
}

/**
 * A parent sets a new (temporary) password for a kid of their family. In this order (audit B12), so
 * a failed step leaves the kid as untouched as possible:
 *
 * 0. As the parent (`withParent` checked the role before anything else): check the member is a kid
 *    of their family (`kidUserIdToReset`). Nothing has changed yet.
 * 1. The admin client sets the password. If it fails, nothing has changed: no flag, old password.
 * 2. As the parent, `require_password_change()` flags the kid to choose a new password at next sign-in
 *    (and is the permission check of record). If it fails, the parent sees an error and resets again;
 *    the kid can still sign in with the new password, and the next reset sets the flag.
 * 3. The admin client signs the kid out everywhere (audit P5), so the old password's sessions end.
 *    Best effort: the flag already keeps any session that survives away from everything but choosing
 *    a new password, and the kid needs the temporary one to choose it.
 */
export const POST = withParent(async (request, _user, context: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context.params).id, "Invalid member identifier.");
  const { password } = await parseBody(request, resetKidPasswordSchema, "Check the password and try again.");

  const kidUserId = await kidUserIdToReset(id);
  const admin = getAuthAdmin();
  await admin.setPassword(kidUserId, password);

  const flaggedUserId = await getRepositories().family.requirePasswordChange(id);
  if (flaggedUserId !== kidUserId) throw new Error(FAILURE);

  try {
    await admin.signOutEverywhere(kidUserId);
  } catch (error) {
    log.error("kid_sessions_signout_failed", { memberId: id, ...errorFields(error) });
  }

  return json({ success: true });
}, { failure: FAILURE });

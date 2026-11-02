import { DELETE_INVALID, deleteManagedKidAccount } from "@/lib/account/deletion";
import { familyView } from "@/lib/family/views";
import { withParent } from "@/lib/http/permission";
import { accountDeletionAttempts, TOO_MANY_ACCOUNT_DELETIONS } from "@/lib/http/rate-limit";
import { json, parseBody, parseId, tooManyRequests } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { deleteKidAccountSchema } from "@/lib/validation/account";

const FAILURE = "Unable to delete the kid's account. Please try again.";

/**
 * A parent deletes a kid account made for their family (security plan S13): `{ currentPassword,
 * confirmName }`, the parent's own password and the kid's name → the updated family, the same shape
 * as `GET /api/family`. See `deleteManagedKidAccount` for the order of the steps.
 *
 * `withParent` refuses anyone who isn't a parent; `delete_managed_kid_data()` checks it again and
 * refuses a member who isn't a kid account made for this family (403, the creator removes those),
 * an unknown member (404) and a wrong name (422). Every attempt counts toward the deletion limit
 * the account's own deletion uses.
 */
export const DELETE = withParent(async (request, user, context: { params: Promise<{ id: string }> }) => {
  const id = parseId((await context.params).id, "Invalid member identifier.");
  const wait = accountDeletionAttempts.retryAfterSeconds(user.id);
  if (wait > 0) return tooManyRequests(TOO_MANY_ACCOUNT_DELETIONS, wait);

  const input = await parseBody(request, deleteKidAccountSchema, DELETE_INVALID);
  accountDeletionAttempts.recordAttempt(user.id);

  await deleteManagedKidAccount(user, id, input);

  const family = await getRepositories().family.getFamily();
  if (!family) throw new Error(FAILURE);
  return json({ family: familyView(family) });
}, { failure: FAILURE });

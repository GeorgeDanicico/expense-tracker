import type { NextRequest } from "next/server";

import { CURRENCY_RELABEL, currencyRelabelMessage } from "@/lib/account/currency-change";
import { DELETE_INVALID, deleteOwnAccount } from "@/lib/account/deletion";
import { loadAccount } from "@/lib/account/load-account";
import { accountDeletionAttempts, TOO_MANY_ACCOUNT_DELETIONS } from "@/lib/http/rate-limit";
import { HttpError, json, noContent, parseBody, readJson, tooManyRequests, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { isSupportedCurrency } from "@/lib/utils/currency";
import { deleteAccountSchema } from "@/lib/validation/account";

/**
 * Answers an account that must choose a new password too (`allowPasswordChangeRequired`): the browser
 * reads `mustChangePassword` here to send it to the change-password page. Every other account route
 * refuses such an account with 403 `password_change_required`. The `(app)` layout puts the same
 * answer (`loadAccount`) in the page, so the browser only asks here outside it or to refresh it.
 */
export const GET = withUser(async (_request, user) => json(await loadAccount(user)), {
  failure: "Unable to load account settings.",
  allowPasswordChangeRequired: true,
});

/**
 * `{ currency, confirmRelabel? }`. Expenses carry no currency of their own, so a change relabels every
 * past amount (audit B10). While the user has expenses, a change without `confirmRelabel: true` is
 * refused with 409 `currency_relabel`, its message saying how many; the expenses are only counted
 * when the currency really changes.
 */
export const PATCH = withUser(async (request: NextRequest, user) => {
  const payload = (await readJson(request)) as { currency?: unknown; confirmRelabel?: unknown } | null;
  if (!isSupportedCurrency(payload?.currency)) {
    throw new HttpError(422, "Choose a supported currency.");
  }
  const { account, expenses } = getRepositories();

  if (payload.confirmRelabel !== true && (await account.getCurrency(user.id)) !== payload.currency) {
    const count = await expenses.count(user.id);
    if (count > 0) return json({ error: currencyRelabelMessage(count, payload.currency), code: CURRENCY_RELABEL }, 409);
  }

  await account.updateCurrency(user, payload.currency);

  return json(await loadAccount(user, payload.currency));
}, { failure: "The currency could not be saved. Please try again." });

/**
 * Deletes the signed-in user's account: `{ currentPassword, confirm }` with `confirm` the typed
 * phrase "delete my account" → 204, every session ended and this browser signed out. See
 * `deleteOwnAccount` for the order of the steps and why a failure can be retried.
 *
 * Refused with the database's own message: a family's creator (409, delete the family first), a
 * member of a family (409, be removed first) and an account a family manages (403, a parent deletes
 * it). A wrong password is a 422 on `currentPassword`. Every attempt counts toward
 * `ACCOUNT_DELETION_MAX_ATTEMPTS` an hour (429 past it), which also caps password guessing.
 */
export const DELETE = withUser(async (request: NextRequest, user) => {
  const wait = accountDeletionAttempts.retryAfterSeconds(user.id);
  if (wait > 0) return tooManyRequests(TOO_MANY_ACCOUNT_DELETIONS, wait);

  const input = await parseBody(request, deleteAccountSchema, DELETE_INVALID);
  accountDeletionAttempts.recordAttempt(user.id);

  await deleteOwnAccount(user, input);
  return noContent();
}, { failure: "Unable to delete your account. Please try again." });

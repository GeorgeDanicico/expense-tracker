import type { ScopedMutator } from "swr";

import type { AccountData } from "@/lib/account/types";
import {
  ACCOUNT_API_KEY,
  ACCOUNT_NOTICES_API_KEY,
  FAMILY_API_KEY,
  FAMILY_INVITES_API_KEY,
  type FamilyResponse,
  type NoticesResponse,
} from "@/lib/api/keys";

// The account and the family list are stable data (`stable-data.ts`): SWR doesn't ask for them again
// when a page opens, so every write that changes one of them has to update its key here (PF8).
// What to refresh after each mutation of the modules not yet on an API object and hooks. Every helper
// takes the global `mutate` from `useSWRConfig()`. Retry buttons keep calling their own bound
// `mutate()`. Expenses, saved tabs and imports moved out in U8 (`expense-cache.ts`, `useExpenseWrites`),
// investments and net worth in U9 (`useInvestmentWrites`, `useNetWorthWrites`).

/** After the caller's picture changes: their account (sidebar, settings) and the family list. */
export function invalidateAfterAvatarChange(mutate: ScopedMutator) {
  return Promise.all([mutate(ACCOUNT_API_KEY), mutate(FAMILY_API_KEY)]);
}

/**
 * After the caller's currency changes: caches the updated account, and reloads the family list,
 * which shows each member's currency (another member sees yours when viewing you).
 */
export function afterCurrencyChanged(mutate: ScopedMutator, account: AccountData) {
  return Promise.all([mutate(ACCOUNT_API_KEY, account, { revalidate: false }), mutate(FAMILY_API_KEY)]);
}

/** Clears every cached response without refetching: signing out, before the full page load to `/login`. */
export function afterSignOut(mutate: ScopedMutator) {
  return mutate(() => true, undefined, { revalidate: false });
}

/** After creating or joining a family: caches the new family and reloads the account, whose membership changed. */
export async function afterFamilyJoined(mutate: ScopedMutator, response: FamilyResponse) {
  await mutate(FAMILY_API_KEY, response, { revalidate: false });
  await mutate(ACCOUNT_API_KEY);
}

/** Drops the dismissed notice from the cached list, so the next one shows without a refetch. */
export function afterNoticeDismissed(mutate: ScopedMutator, id: string) {
  return mutate(
    ACCOUNT_NOTICES_API_KEY,
    (current: NoticesResponse | undefined) => current
      ? { notices: current.notices.filter((notice) => notice.id !== id) }
      : current,
    { revalidate: false },
  );
}

/** After changing the family (a member's permissions, or a new kid): caches the updated family. */
export function afterFamilyChanged(mutate: ScopedMutator, response: FamilyResponse) {
  return mutate(FAMILY_API_KEY, response, { revalidate: false });
}

/** After creating or revoking an invite: reloads the pending invites. */
export function afterInvitesChanged(mutate: ScopedMutator) {
  return mutate(FAMILY_INVITES_API_KEY);
}

/** After removing a member: reloads the family, so the member disappears from the list. */
export function afterMemberRemoved(mutate: ScopedMutator) {
  return mutate(FAMILY_API_KEY);
}

/** After deleting the family: caches "no family" and reloads the account, whose membership is gone. */
export function afterFamilyDeleted(mutate: ScopedMutator) {
  return afterFamilyJoined(mutate, { family: null });
}

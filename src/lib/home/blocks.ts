import type { AccountData } from "@/lib/account/types";
import { can } from "@/lib/permissions";

/**
 * Which blocks Home has for this account: the spending blocks need the expenses permission, the
 * to-dos a family (the reminders are everyone's). Nothing but the reminders until the account has
 * loaded. The browser (`useHomeBlocks`) and Home's server render (`loadHomeFallback`) both decide with
 * it, so the server loads exactly the blocks the page will show (PF6).
 */
export function homeBlocks(account: AccountData | undefined) {
  const memberId = account?.membership?.memberId ?? null;
  return { spending: account ? can(account.membership, "expenses", "edit") : false, todos: memberId !== null, memberId };
}

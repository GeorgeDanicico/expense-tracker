import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShellClient } from "@/app/(app)/app-shell-client";
import { loadPageAccount } from "@/lib/account/load-account";
import { loadNotices } from "@/lib/account/load-notices";
import { CHANGE_PASSWORD_PATH } from "@/lib/account/password-change";
import { loginUrl } from "@/lib/api/auth-redirect";
import { ACCOUNT_NOTICES_API_KEY, REMINDERS_SUMMARY_API_KEY } from "@/lib/api/keys";
import { PAGE_PATH_HEADER } from "@/lib/http/page-path";
import { reminderSummary } from "@/lib/reminders/service";
import { prefetch } from "@/lib/server-prefetch";

const LAYOUT_PATH = "(app) layout";

/**
 * The session gate for every signed-in page (PF5, audit P12). On the server, before any of the app's
 * JavaScript is sent: no session (signed out, expired, a deleted account) → `/login?next=<this page>`;
 * an account that must choose a new password (a kid's first sign-in, a reset) → `/change-password`.
 * Otherwise the shell renders with the account already in SWR's cache, so nothing waits for
 * `/api/account`. The account is the same `loadAccount` answer the route gives. The two things the
 * shell itself shows, the Reminders badge's count (`reminderSummary`) and the unseen notices
 * (`loadNotices`, with the family feature on), are started here without waiting for them and stream
 * into the shell. Each is the answer its route gives; the shell would otherwise ask the browser for
 * both on every cold load, after its scripts have run (PF8).
 *
 * It awaits the account because the redirects depend on it, which holds the first byte of a cold
 * load for that long. A layout doesn't render again on client navigation, so only the first load
 * pays. For the same reason this isn't the only check: every API route checks the session itself,
 * a 401 sends the browser to sign in (`auth-redirect.ts`) and a 403 `password_change_required` to
 * `/change-password` (`password-change.ts`).
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const account = await loadPageAccount();
  if (!account) redirect(loginUrl((await headers()).get(PAGE_PATH_HEADER)));
  if (account.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);

  const fallback = {
    [REMINDERS_SUMMARY_API_KEY]: prefetch(LAYOUT_PATH, REMINDERS_SUMMARY_API_KEY, () => reminderSummary()),
    ...(account.features.family ? { [ACCOUNT_NOTICES_API_KEY]: prefetch(LAYOUT_PATH, ACCOUNT_NOTICES_API_KEY, loadNotices) } : {}),
  };
  return <AppShellClient account={account} fallback={fallback}>{children}</AppShellClient>;
}

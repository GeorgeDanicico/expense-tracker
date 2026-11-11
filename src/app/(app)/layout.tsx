import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShellClient } from "@/app/(app)/app-shell-client";
import { loadPageAccount } from "@/lib/account/load-account";
import { CHANGE_PASSWORD_PATH } from "@/lib/account/password-change";
import { loginUrl } from "@/lib/api/auth-redirect";
import { PAGE_PATH_HEADER } from "@/lib/http/page-path";

/**
 * The session gate for every signed-in page (PF5, audit P12). On the server, before any of the app's
 * JavaScript is sent: no session (signed out, expired, a deleted account) → `/login?next=<this page>`;
 * an account that must choose a new password (a kid's first sign-in, a reset) → `/change-password`.
 * Otherwise the shell renders with the account already in SWR's cache, so nothing waits for
 * `/api/account`. The account is the same `loadAccount` answer the route gives.
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

  return <AppShellClient account={account}>{children}</AppShellClient>;
}

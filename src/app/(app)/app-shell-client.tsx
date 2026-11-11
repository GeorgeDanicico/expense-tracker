"use client";

import { useEffect } from "react";
import { AccountNoticeDialog } from "@/components/family/account-notice-dialog";
import { AppShell } from "@/components/layout/app-shell";
import { useAccount } from "@/hooks/use-account";
import type { AccountData } from "@/lib/account/types";
import { CHANGE_PASSWORD_PATH } from "@/lib/account/password-change";
import { loadAfterSessionChange } from "@/lib/api/auth-redirect";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { ServerFallback, type ServerFallbackData } from "@/lib/api/server-fallback";

/**
 * The browser half of the `(app)` layout: what the server loaded becomes SWR's fallback, so
 * `useAccount()` has the account on the first render, here and in every page, and the Reminders
 * badge gets its count as it streams in (`remindersSummary` is a promise the layout started and did
 * not wait for; one that resolves to `undefined` failed, and its reader then asks itself).
 */
export function AppShellClient({ account, fallback, children }: {
  account: AccountData;
  /** The shell's other first answers by SWR key (the Reminders count, the notices), each a promise the layout didn't wait for. */
  fallback: ServerFallbackData;
  children: React.ReactNode;
}) {
  return (
    <ServerFallback fallback={{ [ACCOUNT_API_KEY]: account, ...fallback }}>
      <SignedInShell>{children}</SignedInShell>
    </ServerFallback>
  );
}

/**
 * The shell, from the account in SWR's cache rather than the server's copy, so a newer answer (a new
 * picture, another account after signing in again) wins over what the page was rendered with.
 */
function SignedInShell({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const mustChangePassword = account?.mustChangePassword === true;

  // The server sent this page only after checking the flag; this catches it turning on later, when
  // the account is loaded again while the app is open (a parent reset the kid's password).
  useEffect(() => {
    if (mustChangePassword) loadAfterSessionChange(CHANGE_PASSWORD_PATH);
  }, [mustChangePassword]);

  if (!account) return null;
  return (
    <AppShell signInName={account.signInName} avatarUrl={account.avatarUrl}>
      {children}
      {account.features.family ? <AccountNoticeDialog /> : null}
    </AppShell>
  );
}

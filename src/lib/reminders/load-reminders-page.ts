import "server-only";

import { loadPageAccount } from "@/lib/account/load-account";
import type { ServerFallbackData } from "@/lib/api/server-fallback";
import { REMINDERS_API_KEY } from "@/lib/api/keys";
import { loadReminders } from "@/lib/reminders/load-reminders";
import { prefetch } from "@/lib/server-prefetch";

/**
 * The Reminders page's first data, started on the server (PF7; the pattern is in
 * src/lib/server-prefetch.ts): the caller's list and the recent completions, one key. The nav badge's
 * count (`/api/reminders/summary`) is read by the shell, outside this page's fallback, and stays the
 * browser's request. Empty with no session: the layout sends that visitor to sign in.
 */
export async function loadRemindersFallback(): Promise<ServerFallbackData> {
  if (!(await loadPageAccount())) return {};
  return { [REMINDERS_API_KEY]: prefetch("/reminders", REMINDERS_API_KEY, loadReminders) };
}

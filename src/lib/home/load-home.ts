import "server-only";

import { loadPageAccount } from "@/lib/account/load-account";
import type { ServerFallbackData } from "@/lib/api/server-fallback";
import { homeDashboardApiKey, REMINDERS_API_KEY, TODOS_API_KEY } from "@/lib/api/keys";
import { loadDashboard } from "@/lib/expenses/load-dashboard";
import { homeBlocks } from "@/lib/home/blocks";
import { loadReminders } from "@/lib/reminders/load-reminders";
import { prefetch } from "@/lib/server-prefetch";
import { loadTodos } from "@/lib/todos/load-todos";

/*
 * Home's first data, started on the server (PF6). The pattern is in src/lib/server-prefetch.ts.
 *
 * The SWR spike (11 November 2026, SWR 2.4.1, React 19.2, Next 16.4, a production build in the lab):
 * a client component calling plain `useSWR(key)`, without `suspense: true`, under a `<Suspense>`,
 * with an unawaited promise for `key` in `SWRConfig`'s `fallback`, **waits for the promise**. The
 * server sent the Suspense fallback first and streamed the component's HTML, with the data, once the
 * promise resolved (1.5 s later); in the browser the component hydrated with that data. SWR calls
 * React's `use()` on a promise fallback whatever `suspense` says (`useSWRHandler`: `isPromiseLike(fallback)
 * ? use(fallback)`). So Home's components keep their hooks and their `!data` branches; only their
 * `<Suspense>` boundaries are new. Two more things it showed: right after hydration SWR asked for the
 * key again (fallback data counts as stale), which `useServerFirstSWR` now skips; and a promise that
 * resolved to `undefined` left the key to the browser, which fetched it. That is how a failed loader
 * falls back.
 */

/** The page these loads are for, as `server_prefetch_failed` names it. */
const HOME_PATH = "/dashboard";

/**
 * Home's SWR fallback: an unawaited promise per block this person has (`homeBlocks`, the same rule
 * the browser uses), keyed exactly as the blocks' hooks ask. The reminders for everyone; the month
 * and the recent expenses (one key) only with the expenses permission, which the loader checks again
 * as the route does; the board only with a family. Empty with no session: the layout sends that visitor to
 * sign in.
 */
export async function loadHomeFallback(): Promise<ServerFallbackData> {
  const account = await loadPageAccount();
  if (!account) return {};
  const { spending, todos } = homeBlocks(account);

  const fallback: ServerFallbackData = {
    [REMINDERS_API_KEY]: prefetch(HOME_PATH, REMINDERS_API_KEY, loadReminders),
  };
  if (spending) {
    const key = homeDashboardApiKey();
    fallback[key] = prefetch(HOME_PATH, key, loadDashboard);
  }
  if (todos) fallback[TODOS_API_KEY] = prefetch(HOME_PATH, TODOS_API_KEY, loadTodos);
  return fallback;
}

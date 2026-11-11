import "server-only";

import { loadPageAccount } from "@/lib/account/load-account";
import type { ServerFallbackData } from "@/lib/api/server-fallback";
import { FAMILY_API_KEY, TODOS_API_KEY } from "@/lib/api/keys";
import { loadFamily } from "@/lib/family/load-family";
import { prefetch } from "@/lib/server-prefetch";
import { loadTodos } from "@/lib/todos/load-todos";

const TODOS_PATH = "/todos";

/**
 * The To-dos page's first data, started on the server (PF7; the pattern is in src/lib/server-prefetch.ts):
 * the open board and the family list (the filter chips' members and colours), both only for someone
 * in a family, as the page draws them. Empty with no session or no family: the page shows its own state.
 */
export async function loadTodosFallback(): Promise<ServerFallbackData> {
  const account = await loadPageAccount();
  if (!account?.membership) return {};
  return {
    [TODOS_API_KEY]: prefetch(TODOS_PATH, TODOS_API_KEY, loadTodos),
    [FAMILY_API_KEY]: prefetch(TODOS_PATH, FAMILY_API_KEY, loadFamily),
  };
}

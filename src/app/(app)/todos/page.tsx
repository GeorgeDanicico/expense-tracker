import { ServerFallback } from "@/lib/api/server-fallback";
import { loadTodosFallback } from "@/lib/todos/load-todos-page";

import { TodosClient } from "./todos-client";

/** The family board. A server component since PF7: it starts the board's data here and the board streams in (`loadTodosFallback`). */
export default async function TodosPage() {
  return (
    <ServerFallback fallback={await loadTodosFallback()}>
      <TodosClient />
    </ServerFallback>
  );
}

import "server-only";

import type { TodosResponse } from "@/lib/api/keys";
import { requireFamilyFeature } from "@/lib/family/feature";
import { parseInput } from "@/lib/http/route";
import { listTodos } from "@/lib/todos/service";
import { todoListQuerySchema } from "@/lib/validation/todo";

/** `GET /api/todos`'s answer for `query` (its search params): 404 while the family flag is off. The route and Home's server render both call it (PF6). */
export async function loadTodos(query: URLSearchParams): Promise<TodosResponse> {
  requireFamilyFeature();
  const { doneSince } = parseInput(Object.fromEntries(query), todoListQuerySchema, "Check the board's filters and try again.");
  return { todos: await listTodos(doneSince) };
}

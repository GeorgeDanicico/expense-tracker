import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, withUser } from "@/lib/http/route";
import { loadTodos } from "@/lib/todos/load-todos";
import { createTodo } from "@/lib/todos/service";
import { todoSchema } from "@/lib/validation/todo";

export const GET = withUser(async (request) => json(await loadTodos(new URL(request.url).searchParams)), { failure: "Unable to load the to-do board." });

export const POST = withUser(async (request, user) => {
  requireFamilyFeature();
  const input = await parseBody(request, todoSchema, "Check the highlighted details and try again.");
  return json({ todo: await createTodo(user.id, input) }, 201);
}, { failure: "Unable to save the to-do." });

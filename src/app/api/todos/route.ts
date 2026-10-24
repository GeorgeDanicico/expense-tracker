import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, parseInput, withUser } from "@/lib/http/route";
import { createTodo, listTodos } from "@/lib/todos/service";
import { todoListQuerySchema, todoSchema } from "@/lib/validation/todo";

export const GET = withUser(async (request) => {
  requireFamilyFeature();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { doneSince } = parseInput(query, todoListQuerySchema, "Check the board's filters and try again.");
  return json({ todos: await listTodos(doneSince) });
}, { failure: "Unable to load the to-do board." });

export const POST = withUser(async (request, user) => {
  requireFamilyFeature();
  const input = await parseBody(request, todoSchema, "Check the highlighted details and try again.");
  return json({ todo: await createTodo(user.id, input) }, 201);
}, { failure: "Unable to save the to-do." });

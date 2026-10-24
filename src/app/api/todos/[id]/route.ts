import { requireFamilyFeature } from "@/lib/family/feature";
import { json, notFound, parseBody, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { TODO_NOT_FOUND_MESSAGE } from "@/lib/todos/service";
import { todoPatchSchema } from "@/lib/validation/todo";

type TodoRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withUser(async (request, _user, context: TodoRouteContext) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid to-do identifier.");
  const patch = await parseBody(request, todoPatchSchema, "Check the highlighted details and try again.");
  const todo = await getRepositories().todos.update(id, patch) ?? notFound(TODO_NOT_FOUND_MESSAGE);
  return json({ todo });
}, { failure: "Unable to save the to-do." });

export const DELETE = withUser(async (_request, _user, context: TodoRouteContext) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid to-do identifier.");
  if (!(await getRepositories().todos.delete(id))) notFound(TODO_NOT_FOUND_MESSAGE);
  return json({ success: true });
}, { failure: "Unable to delete the to-do." });

import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, parseId, withUser } from "@/lib/http/route";
import { moveTodo } from "@/lib/todos/service";
import { moveSchema } from "@/lib/validation/todo";

type MoveRouteContext = { params: Promise<{ id: string }> };

export const POST = withUser(async (request, _user, context: MoveRouteContext) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid to-do identifier.");
  const move = await parseBody(request, moveSchema, "Check where the card should go and try again.");
  return json({ todo: await moveTodo(id, move) });
}, { failure: "Unable to move the to-do." });

import { withPermission } from "@/lib/http/permission";
import { json, parseId } from "@/lib/http/route";
import { undoImport } from "@/lib/imports/service";

/**
 * Undoes a confirmed import: deletes the expenses it created, including any edited since. Answers
 * `{ batch, removed }`. 404 when it is missing; 409 when it isn't confirmed or is too old to undo.
 */
export const POST = withPermission("expenses", "edit", async (_request, _user, context: RouteContext<"/api/imports/[id]/undo">) => {
  const id = parseId((await context.params).id, "Invalid import identifier.");
  return json(await undoImport(id));
}, { failure: "Unable to undo the import." });

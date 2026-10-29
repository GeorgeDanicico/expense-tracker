import { withPermission } from "@/lib/http/permission";
import { json, noContent, parseId } from "@/lib/http/route";
import { discardDraft, getDraft, getImport } from "@/lib/imports/service";

const INVALID_ID_MESSAGE = "Invalid import identifier.";

/**
 * A draft with its rows, duplicate flags and whether each row can be imported (`{ batch, rows }`),
 * or, for a confirmed or undone import, its summary (`{ batch }`). 404 when it is missing,
 * someone else's or an expired draft.
 */
export const GET = withPermission("expenses", "edit", async (_request, user, context: RouteContext<"/api/imports/[id]">) => {
  const id = parseId((await context.params).id, INVALID_ID_MESSAGE);
  const batch = await getImport(id);
  if (batch.status !== "draft") return json({ batch });
  return json(await getDraft(user.id, id));
}, { failure: "Unable to load the import." });

/** Discards a draft and its rows. 204; 404 when there is no such draft, 409 when it was confirmed or undone. */
export const DELETE = withPermission("expenses", "edit", async (_request, _user, context: RouteContext<"/api/imports/[id]">) => {
  const id = parseId((await context.params).id, INVALID_ID_MESSAGE);
  await discardDraft(id);
  return noContent();
}, { failure: "Unable to discard the import." });

import { withPermission } from "@/lib/http/permission";
import { json, parseId, readJson } from "@/lib/http/route";
import { confirmDraft } from "@/lib/imports/service";

/**
 * Saves the ticked rows of a draft, with their final values, as the caller's expenses, in one
 * transaction. Answers `{ batch, created }`, the expenses as stored. 422 with field errors keyed by
 * row (`rows.0.amount`) when a row is invalid, isn't part of the import or is in another currency,
 * and nothing is saved; 404 when the draft is missing or expired; 409 when it was confirmed already.
 */
export const POST = withPermission("expenses", "edit", async (request, user, context: RouteContext<"/api/imports/[id]/confirm">) => {
  const id = parseId((await context.params).id, "Invalid import identifier.");
  return json(await confirmDraft(user.id, id, await readJson(request)));
}, { failure: "The expenses could not be saved." });

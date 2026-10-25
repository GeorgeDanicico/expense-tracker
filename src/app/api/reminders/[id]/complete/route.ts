import { json, parseId, parseInput, readJson, withUser } from "@/lib/http/route";
import { completeReminder, completeReminderWithExpense } from "@/lib/reminders/service";
import { completeReminderSchema } from "@/lib/validation/reminder";

type CompleteRouteContext = { params: Promise<{ id: string }> };

/**
 * Marks the open occurrence done → `{ reminder }`. The body is optional (`completeReminderSchema`):
 * `{ logExpense: true }` first adds the reminder's expense template for the occurrence and links it
 * on the completion → `{ reminder, expense }` (see `completeReminderWithExpense` for the order).
 */
export const POST = withUser(async (request, user, context: CompleteRouteContext) => {
  const id = parseId((await context.params).id, "Invalid reminder identifier.");
  const body = request ? await readJson(request) : null;
  const input = parseInput(body ?? {}, completeReminderSchema, "Check the expense's details and try again.");
  if (input.logExpense) return json(await completeReminderWithExpense(user.id, id, input));
  return json({ reminder: await completeReminder(id, undefined, input) });
}, { failure: "Unable to mark the reminder done." });

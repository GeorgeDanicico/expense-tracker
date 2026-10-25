import { json, parseBody, parseId, withUser } from "@/lib/http/route";
import { deleteReminder, updateReminder } from "@/lib/reminders/service";
import { reminderSchema } from "@/lib/validation/reminder";

type ReminderRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withUser(async (request, _user, context: ReminderRouteContext) => {
  const id = parseId((await context.params).id, "Invalid reminder identifier.");
  const input = await parseBody(request, reminderSchema, "Check the highlighted details and try again.");
  return json({ reminder: await updateReminder(id, input) });
}, { failure: "Unable to save the reminder." });

export const DELETE = withUser(async (_request, _user, context: ReminderRouteContext) => {
  const id = parseId((await context.params).id, "Invalid reminder identifier.");
  await deleteReminder(id);
  return json({ success: true });
}, { failure: "Unable to delete the reminder." });

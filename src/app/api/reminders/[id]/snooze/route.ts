import { json, parseBody, parseId, withUser } from "@/lib/http/route";
import { snoozeReminder } from "@/lib/reminders/service";
import { snoozeSchema } from "@/lib/validation/reminder";

type SnoozeRouteContext = { params: Promise<{ id: string }> };

export const POST = withUser(async (request, _user, context: SnoozeRouteContext) => {
  const id = parseId((await context.params).id, "Invalid reminder identifier.");
  const snooze = await parseBody(request, snoozeSchema, "Choose how long to snooze and try again.");
  return json({ reminder: await snoozeReminder(id, snooze) });
}, { failure: "Unable to snooze the reminder." });

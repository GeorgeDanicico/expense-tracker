import { json, parseBody, withUser } from "@/lib/http/route";
import { loadReminders } from "@/lib/reminders/load-reminders";
import { createReminder } from "@/lib/reminders/service";
import { reminderSchema } from "@/lib/validation/reminder";

export const GET = withUser(async (request) => json(await loadReminders(new URL(request.url).searchParams)), { failure: "Unable to load the reminders." });

export const POST = withUser(async (request, user) => {
  const input = await parseBody(request, reminderSchema, "Check the highlighted details and try again.");
  return json({ reminder: await createReminder(user.id, input) }, 201);
}, { failure: "Unable to save the reminder." });

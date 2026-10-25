import { json, parseBody, parseInput, withUser } from "@/lib/http/route";
import { createReminder, listReminders } from "@/lib/reminders/service";
import { reminderListQuerySchema, reminderSchema } from "@/lib/validation/reminder";

export const GET = withUser(async (request) => {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { doneSince } = parseInput(query, reminderListQuerySchema, "Check the reminders' filters and try again.");
  return json(await listReminders(doneSince));
}, { failure: "Unable to load the reminders." });

export const POST = withUser(async (request, user) => {
  const input = await parseBody(request, reminderSchema, "Check the highlighted details and try again.");
  return json({ reminder: await createReminder(user.id, input) }, 201);
}, { failure: "Unable to save the reminder." });

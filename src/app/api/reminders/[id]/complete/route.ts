import { json, parseId, withUser } from "@/lib/http/route";
import { completeReminder } from "@/lib/reminders/service";

type CompleteRouteContext = { params: Promise<{ id: string }> };

export const POST = withUser(async (_request, _user, context: CompleteRouteContext) => {
  const id = parseId((await context.params).id, "Invalid reminder identifier.");
  return json({ reminder: await completeReminder(id) });
}, { failure: "Unable to mark the reminder done." });

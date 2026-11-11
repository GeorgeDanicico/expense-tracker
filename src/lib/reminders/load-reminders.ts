import "server-only";

import type { RemindersResponse } from "@/lib/api/keys";
import { parseInput } from "@/lib/http/route";
import { listReminders } from "@/lib/reminders/service";
import { reminderListQuerySchema } from "@/lib/validation/reminder";

/** `GET /api/reminders`'s answer for `query` (its search params). The route and Home's server render both call it (PF6). */
export async function loadReminders(query: URLSearchParams): Promise<RemindersResponse> {
  const { doneSince } = parseInput(Object.fromEntries(query), reminderListQuerySchema, "Check the reminders' filters and try again.");
  return listReminders(doneSince);
}

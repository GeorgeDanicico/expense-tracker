import { json, withUser } from "@/lib/http/route";
import { reminderSummary } from "@/lib/reminders/service";

export const GET = withUser(async () => json(await reminderSummary()), { failure: "Unable to load the reminders." });

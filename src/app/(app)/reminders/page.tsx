import { ServerFallback } from "@/lib/api/server-fallback";
import { loadRemindersFallback } from "@/lib/reminders/load-reminders-page";

import { RemindersClient } from "./reminders-client";

/** The caller's reminders. A server component since PF7: it starts the list here and the list streams in (`loadRemindersFallback`). */
export default async function RemindersPage() {
  return (
    <ServerFallback fallback={await loadRemindersFallback()}>
      <RemindersClient />
    </ServerFallback>
  );
}

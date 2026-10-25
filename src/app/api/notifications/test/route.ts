import { TEST_ALREADY_SENT } from "@/lib/api/keys";
import { json, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

/**
 * Queues a test notification for the caller: 202 `{ queued: true }`, or 200 `{ queued: false,
 * message }` within a minute of the last one (nothing queued).
 */
export const POST = withUser(async () => {
  const queued = await getRepositories().notificationSettings.sendTest();
  return queued ? json({ queued: true }, 202) : json({ queued: false, message: TEST_ALREADY_SENT });
}, { failure: "Unable to send a test notification. Please try again." });

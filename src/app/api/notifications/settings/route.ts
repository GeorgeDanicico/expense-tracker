import { json, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { notificationSettingsPatchSchema } from "@/lib/validation/notifications";

/** The caller's switches and how many browsers they enabled. */
export const GET = withUser(async () => json(await getRepositories().notificationSettings.get()), {
  failure: "Unable to load your notification settings.",
});

/** Changes one or more switches and answers the settings. */
export const PATCH = withUser(async (request, user) => {
  const patch = await parseBody(request, notificationSettingsPatchSchema, "Invalid notification settings.");
  return json(await getRepositories().notificationSettings.update(user.id, patch));
}, { failure: "Unable to save your notification settings. Please try again." });

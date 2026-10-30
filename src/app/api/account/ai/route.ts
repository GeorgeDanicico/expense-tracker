import { loadAiSettings, setAiOptIn } from "@/lib/ai/settings";
import { json, parseBody, withUser } from "@/lib/http/route";
import { aiSwitchSchema } from "@/lib/validation/ai";

/** The caller's Settings → AI state: the switch, why a kid can't turn it on, and the provider. */
export const GET = withUser(async (_request, user) => json(await loadAiSettings(user.id)), {
  failure: "Unable to load your AI settings.",
});

/**
 * Turns the caller's switch on or off, answering the same shape as GET. Turning it off always works;
 * 403 with the reason for a kid who can't turn it on.
 */
export const PATCH = withUser(async (request, user) => {
  const { enabled } = await parseBody(request, aiSwitchSchema, "Invalid AI setting.");
  return json(await setAiOptIn(user.id, enabled));
}, { failure: "Unable to save your AI setting. Please try again." });

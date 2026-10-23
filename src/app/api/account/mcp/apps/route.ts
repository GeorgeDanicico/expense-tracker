import { getOAuthConsent } from "@/lib/auth";
import type { McpAppsResponse } from "@/lib/api/keys";
import { json, withUser } from "@/lib/http/route";

/** The apps the caller has allowed, as `{ apps }`. The same app can appear once per registration. */
export const GET = withUser(async () => json({ apps: await getOAuthConsent().listConnectedApps() } satisfies McpAppsResponse), {
  failure: "Unable to load the connected apps.",
});

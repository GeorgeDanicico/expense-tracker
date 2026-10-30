import "server-only";

import type { AiSettingsResponse } from "@/lib/api/keys";
import type { AiProviderId } from "@/lib/ai/provider";
import { AI_PROVIDER_POLICIES } from "@/lib/ai/provider-policy";
import { getRepositories } from "@/lib/repositories";

/**
 * The provider named by `AI_PROVIDER`, or null when it is unset or isn't one this app has an
 * adapter for (then no call is made and the privacy text has no provider to name).
 */
export function configuredProvider(env: Record<string, string | undefined> = process.env): AiProviderId | null {
  const id = env.AI_PROVIDER?.trim();
  return id && Object.hasOwn(AI_PROVIDER_POLICIES, id) ? (id as AiProviderId) : null;
}

/**
 * The caller's Settings → AI state. `enabled` is the access rule's `ok`: `my_ai_access` answers
 * `not_permitted` before it looks at the switch, so a kid whose permission was turned off reads
 * switched off here whatever their stored switch says. `blockReason` says why a kid can't turn it on.
 */
export async function loadAiSettings(userId: string): Promise<AiSettingsResponse> {
  const access = await getRepositories().aiGate.access(userId);
  return {
    enabled: access === "ok",
    blockReason: access === "not_permitted" ? "not_permitted" : null,
    provider: configuredProvider(),
  };
}

/** Turns the caller's switch on or off, then answers the new settings. Refusals are `DomainError`s (403 for a blocked kid). */
export async function setAiOptIn(userId: string, enabled: boolean): Promise<AiSettingsResponse> {
  await getRepositories().aiGate.setOptIn(userId, enabled);
  return loadAiSettings(userId);
}

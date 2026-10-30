import type { AiProviderId } from "@/lib/ai/provider";

/**
 * What the Settings → AI privacy text says about the provider that receives a statement's text:
 * its name and what its API data policy says. Plain data, so the page can import it.
 *
 * OpenAI: read on 30 October 2026 from OpenAI's "Data controls in the OpenAI platform" guide
 * (https://developers.openai.com/api/docs/guides/your-data, which platform.openai.com/docs/guides/your-data
 * redirects to). It says: data sent to the API is not used to train or improve OpenAI's models unless
 * the customer opts in to share it; abuse-monitoring logs are kept for up to 30 days (longer only
 * where law requires it or it is needed to protect against harm), unless the customer is approved
 * for Modified Abuse Monitoring or Zero Data Retention; and `store` set to true, or left out, keeps a
 * response as application state for at least 30 days, which is why the adapter
 * (`providers/openai.ts`) sends `store: false`. Re-read the guide, and change this text with it,
 * whenever the policy changes.
 */
export type AiProviderPolicy = {
  /** The provider's name as users know it. */
  name: string;
  /** What the provider's API data policy says, in the words the privacy text uses. */
  policy: string;
  /** Where the policy was read, for people maintaining the text. */
  source: string;
};

export const AI_PROVIDER_POLICIES: Partial<Record<AiProviderId, AiProviderPolicy>> = {
  openai: {
    name: "OpenAI",
    policy:
      "OpenAI says data sent through its API isn't used to train its models unless the customer opts in to share it, and we haven't. We ask OpenAI not to store the response, but OpenAI may keep API logs for up to 30 days to watch for abuse.",
    source: "https://developers.openai.com/api/docs/guides/your-data",
  },
};

/** The policy text for a provider, or null when none is on file. */
export function policyFor(id: AiProviderId | null): AiProviderPolicy | null {
  return id ? (AI_PROVIDER_POLICIES[id] ?? null) : null;
}

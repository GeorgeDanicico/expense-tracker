import { apiRequest } from "@/lib/api/client";
import type { Decision } from "@/components/oauth/consent-views";
import { oauthApproveApiUrl, oauthDenyApiUrl, type OAuthDecisionResponse } from "@/lib/api/keys";

/** Answers the request through our API; resolves to the URL that sends the browser back to the app. */
export async function answerAuthorization(authorizationId: string, decision: Decision) {
  const url = decision === "approve" ? oauthApproveApiUrl(authorizationId) : oauthDenyApiUrl(authorizationId);
  const { redirectUrl } = await apiRequest<OAuthDecisionResponse>(url, { method: "POST" });
  return redirectUrl;
}

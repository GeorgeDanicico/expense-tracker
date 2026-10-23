"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";

import {
  ConsentExpired,
  ConsentLoadError,
  ConsentLoading,
  ConsentRefusedCard,
  ConsentRequestCard,
  type ConsentDetails,
  type Decision,
  type RefusedDetails,
} from "@/components/oauth/consent-views";
import { apiFormError } from "@/hooks/use-api-form";
import { ApiError, apiRequest } from "@/lib/api/client";
import {
  oauthApproveApiUrl,
  oauthAuthorizationApiKey,
  oauthDenyApiUrl,
  type OAuthAuthorizationResponse,
  type OAuthDecisionResponse,
} from "@/lib/api/keys";
import { isAuthorizationId } from "@/lib/validation/oauth";

export type ConsentScreenState =
  | { view: "loading" }
  /** Not signed in: on the way to the sign-in page, which brings the browser back here. */
  | { view: "signed_out" }
  | { view: "expired" }
  | { view: "error" }
  /** An app the user already allowed, while their access is ok: on the way back to it. */
  | { view: "approved"; redirectUrl: string }
  | { view: "consent"; details: ConsentDetails }
  | { view: "refused"; details: RefusedDetails };

/** The consent page's own path for `authorizationId`, as Supabase sends the browser to it. */
export function consentPath(authorizationId: string) {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

/** The sign-in page, set to come back to this request afterwards. */
export function consentLoginPath(authorizationId: string) {
  return `/login?next=${encodeURIComponent(consentPath(authorizationId))}`;
}

/** Which state the page is in, from the id in the URL and the details request. Kept pure for tests. */
export function consentScreenState({
  authorizationId,
  data,
  error,
}: {
  authorizationId: string | null;
  data?: OAuthAuthorizationResponse;
  error?: unknown;
}): ConsentScreenState {
  if (!authorizationId || !isAuthorizationId(authorizationId)) return { view: "expired" };
  if (error instanceof ApiError && error.status === 401) return { view: "signed_out" };
  if (error instanceof ApiError && error.status === 404) return { view: "expired" };
  if (error) return { view: "error" };
  if (!data) return { view: "loading" };
  if (data.kind === "approved") return { view: "approved", redirectUrl: data.redirectUrl };
  if (data.kind === "refused") return { view: "refused", details: data };
  return { view: "consent", details: data };
}

/** Answers the request through our API; resolves to the URL that sends the browser back to the app. */
export async function answerAuthorization(authorizationId: string, decision: Decision) {
  const url = decision === "approve" ? oauthApproveApiUrl(authorizationId) : oauthDenyApiUrl(authorizationId);
  const { redirectUrl } = await apiRequest<OAuthDecisionResponse>(url, { method: "POST" });
  return redirectUrl;
}

function shouldRetry(error: unknown) {
  return !(error instanceof ApiError && error.status < 500);
}

/**
 * The OAuth consent page (docs/mcp-access-plan.md, M7). Supabase's authorization server sends the
 * browser here with `authorization_id`; the page asks our API about the request, and Allow or Deny
 * answer it there, then follow the URL back to the app.
 */
export function OAuthConsentScreen({ authorizationId }: { authorizationId: string | null }) {
  const router = useRouter();
  const valid = authorizationId !== null && isAuthorizationId(authorizationId);
  // Fetched once: an answered request is gone, so a revalidation would only turn the page into "expired".
  const { data, error, mutate } = useSWR<OAuthAuthorizationResponse>(
    valid ? oauthAuthorizationApiKey(authorizationId) : null,
    { revalidateIfStale: false, revalidateOnReconnect: false, shouldRetryOnError: shouldRetry },
  );
  const [pending, setPending] = useState<Decision | null>(null);
  const [decisionError, setDecisionError] = useState("");
  const state = consentScreenState({ authorizationId, data, error });

  const redirectUrl = state.view === "approved" ? state.redirectUrl : null;
  useEffect(() => {
    if (state.view === "signed_out" && authorizationId) router.replace(consentLoginPath(authorizationId));
  }, [state.view, authorizationId, router]);
  useEffect(() => {
    if (redirectUrl) window.location.assign(redirectUrl);
  }, [redirectUrl]);

  async function decide(decision: Decision) {
    if (pending || !authorizationId) return;
    setPending(decision);
    setDecisionError("");
    try {
      // Stays pending while the browser leaves, so neither button can be pressed again.
      window.location.assign(await answerAuthorization(authorizationId, decision));
    } catch (caught) {
      setPending(null);
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace(consentLoginPath(authorizationId));
        return;
      }
      setDecisionError(apiFormError(caught, "Unable to answer the request. Please try again.").error);
    }
  }

  switch (state.view) {
    case "loading":
    case "signed_out":
      return <ConsentLoading label="Checking the request…" />;
    case "approved":
      return <ConsentLoading label="Returning you to the app…" />;
    case "expired":
      return <ConsentExpired />;
    case "error":
      return <ConsentLoadError retry={() => void mutate()} />;
    case "refused":
      return (
        <ConsentRefusedCard
          details={state.details}
          pending={pending}
          error={decisionError}
          onBack={() => void decide("deny")}
        />
      );
    case "consent":
      return (
        <ConsentRequestCard
          details={state.details}
          pending={pending}
          error={decisionError}
          onDecide={(decision) => void decide(decision)}
        />
      );
  }
}

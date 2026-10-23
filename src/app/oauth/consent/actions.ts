"use server";

import { redirect } from "next/navigation";

import { getAuthenticatedUser, spikeDecideConsent } from "@/lib/auth";

/** [p1-spike] Allow / Deny on the consent page: tells Supabase, then sends the browser back to the app. */
export async function decide(formData: FormData) {
  const authorizationId = formData.get("authorization_id");
  const allow = formData.get("decision") === "allow";
  if (typeof authorizationId !== "string" || !authorizationId) redirect("/oauth/consent");

  const consentPath = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
  if (!(await getAuthenticatedUser())) redirect(`/login?next=${encodeURIComponent(consentPath)}`);

  const redirectUrl = await spikeDecideConsent(authorizationId, allow);
  if (!redirectUrl) redirect(`${consentPath}&failed=1`);
  redirect(redirectUrl);
}

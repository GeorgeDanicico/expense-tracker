import type { Metadata } from "next";

import { OAuthConsentScreen } from "@/components/oauth/consent-screen";

export const metadata: Metadata = { title: "Allow access" };

/**
 * Where Supabase's OAuth server sends the browser when an app (Claude Code and the like) asks to use
 * the account: `/oauth/consent?authorization_id=…`. Outside the app shell, like the sign-in page.
 */
export default async function OAuthConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const { authorization_id: authorizationId } = await searchParams;
  return <OAuthConsentScreen authorizationId={typeof authorizationId === "string" ? authorizationId : null} />;
}

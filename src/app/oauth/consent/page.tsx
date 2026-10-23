import { redirect } from "next/navigation";

import { getAuthenticatedUser, spikeConsentRequest } from "@/lib/auth";

import { decide } from "./actions";

/**
 * [p1-spike] A bare consent page for Supabase's OAuth 2.1 server (authorization path `/oauth/consent`).
 * M7 replaces it with the real page and its API.
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // The spike wants to know what Supabase forwards here (only authorization_id, or more?).
  console.log("[p1-spike] /oauth/consent query keys", Object.keys(params));

  const authorizationId = typeof params.authorization_id === "string" ? params.authorization_id : "";
  if (!authorizationId) {
    return <Shell><p>Missing authorization_id.</p></Shell>;
  }

  const consentPath = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
  if (!(await getAuthenticatedUser())) {
    redirect(`/login?next=${encodeURIComponent(consentPath)}`);
  }

  const request = await spikeConsentRequest(authorizationId);
  if (!request) {
    return <Shell><p>This sign-in request doesn&apos;t exist, has expired, or belongs to someone else.</p></Shell>;
  }
  if (request.kind === "already_approved") {
    redirect(request.redirectUrl);
  }

  let redirectHost = request.redirectUri;
  try {
    redirectHost = new URL(request.redirectUri).host;
  } catch {
    // Show the raw value.
  }

  return (
    <Shell>
      {params.failed ? <p><strong>That didn&apos;t work. Check the server log and try again.</strong></p> : null}
      <h1 style={{ fontSize: "1.4rem", fontWeight: 600 }}>{request.clientName || "An app"} wants to use your account</h1>
      <p>Signed in as {request.userEmail}</p>
      <p>App address: {request.clientUri || "(none)"}</p>
      <p>
        It will send you back to: <strong>{redirectHost}</strong>
      </p>
      <p>Scopes requested: {request.scopes.length ? request.scopes.join(", ") : "(none)"}</p>
      <p>Only allow apps you started connecting yourself.</p>
      <form action={decide} style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
        <input type="hidden" name="authorization_id" value={request.authorizationId} />
        <button type="submit" name="decision" value="allow" style={{ padding: "0.5rem 1rem", fontWeight: 600 }}>
          Allow
        </button>
        <button type="submit" name="decision" value="deny" style={{ padding: "0.5rem 1rem" }}>
          Deny
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem", display: "grid", gap: "0.5rem" }}>
      {children}
    </main>
  );
}

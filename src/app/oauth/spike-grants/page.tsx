import { redirect } from "next/navigation";

import { getAuthenticatedUser, spikeListGrants } from "@/lib/auth";

import { revoke } from "./actions";

/** [p1-spike] Q4: the signed-in user's connected OAuth apps, each with a Revoke button. M8/M9 replace it. */
export default async function SpikeGrantsPage() {
  if (!(await getAuthenticatedUser())) redirect(`/login?next=${encodeURIComponent("/oauth/spike-grants")}`);

  const grants = await spikeListGrants();
  console.log("[p1-spike] grants listed", grants.map((grant) => ({ clientId: grant.clientId, grantedAt: grant.grantedAt })));

  return (
    <main style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui" }}>
      <h1>Connected apps (spike)</h1>
      {grants.length === 0 && <p>No connected apps.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {grants.map((grant) => (
          <li key={grant.clientId} style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <strong>{grant.clientName}</strong>
            <div style={{ fontSize: 13 }}>Client {grant.clientId}</div>
            <div style={{ fontSize: 13 }}>Scopes: {grant.scopes.join(" ") || "(none)"} · Granted {grant.grantedAt}</div>
            <form action={revoke}>
              <input type="hidden" name="client_id" value={grant.clientId} />
              <button type="submit">Revoke</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}

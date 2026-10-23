"use server";

import { redirect } from "next/navigation";

import { spikeRevokeGrant } from "@/lib/auth";

/** [p1-spike] Q4: revoke one app's grant, then back to the list. */
export async function revoke(formData: FormData) {
  const clientId = formData.get("client_id");
  if (typeof clientId === "string" && clientId) await spikeRevokeGrant(clientId);
  redirect("/oauth/spike-grants");
}

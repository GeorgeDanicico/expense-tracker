import { json, withUser } from "@/lib/http/route";
import { getVapidPublicKey } from "@/lib/notifications/config";

/** `{ publicKey }`, the VAPID public key browsers subscribe with; 503 while it isn't configured. */
export const GET = withUser(async () => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) return json({ error: "Notifications aren't set up on this server yet." }, 503);
  return json({ publicKey });
});

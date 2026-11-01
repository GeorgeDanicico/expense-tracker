import "server-only";

import { getEnv } from "@/lib/env";

/**
 * The VAPID public key browsers subscribe with, or null when it isn't set. Public by design (every
 * browser that subscribes gets it); the private key is read only by the worker.
 */
export function getVapidPublicKey() {
  return getEnv().VAPID_PUBLIC_KEY ?? null;
}

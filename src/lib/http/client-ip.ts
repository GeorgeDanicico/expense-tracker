import "server-only";

import { getEnv } from "@/lib/env";

/** The bucket a rate limit uses for a request whose client address can't be trusted or isn't there. */
export const UNKNOWN_CLIENT = "unknown";

/**
 * The client's IP for rate limits, or null when the request carries none we can trust.
 *
 * Each proxy appends the address it saw to `X-Forwarded-For`, so the hops our own proxies add are the
 * last `TRUSTED_PROXY_HOPS` of them and the first of those is the client's address. Earlier hops come
 * from the client and can be anything, so they are never read. Default 1: the proxy in front of the
 * container (Tailscale Serve on the VPS) adds the one hop. Next itself fills the header from the
 * connection's socket address when nothing set it, so a request that reaches the app directly has
 * that one hop too. Next doesn't expose the socket any other way.
 *
 * A header with fewer hops than expected didn't come through our proxies, so it is not trusted:
 * the answer is null, and `TRUSTED_PROXY_HOPS=0` ignores the header altogether. `X-Real-IP` is
 * never read: nothing in front of the app is known to overwrite it, so a client could set it freely.
 *
 * Where a limit can also be keyed on something the client can't change at will (the sign-in name, the
 * user), it is.
 */
export function clientIp(request: Request): string | null {
  const trusted = getEnv().TRUSTED_PROXY_HOPS;
  if (trusted === 0) return null;
  const hops = request.headers.get("x-forwarded-for")?.split(",") ?? [];
  if (hops.length < trusted) return null;
  return hops[hops.length - trusted].trim() || null;
}

/** `clientIp`, or `UNKNOWN_CLIENT`: the key to give a limiter. */
export function clientKey(request: Request | undefined): string {
  return (request && clientIp(request)) || UNKNOWN_CLIENT;
}

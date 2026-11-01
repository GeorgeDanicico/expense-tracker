/**
 * The client's IP for rate limits, or null when the request carries none.
 *
 * Proxies append the address they saw to `X-Forwarded-For`, so the last hop is the one added by the
 * proxy closest to the app: ours (Tailscale Serve on the VPS), or Next itself, which fills the
 * header from the socket when nothing in front set it. Earlier hops come from the client and can
 * be anything. Falls back to `X-Real-IP`.
 *
 * Until S11 confirms what the proxy sets, treat the answer as a hint, not a fact: where a limit can
 * also be keyed on something the client can't change at will (the sign-in name), it is.
 */
export function clientIp(request: Request): string | null {
  const hops = request.headers.get("x-forwarded-for")?.split(",") ?? [];
  const last = hops[hops.length - 1]?.trim();
  return last || request.headers.get("x-real-ip")?.trim() || null;
}

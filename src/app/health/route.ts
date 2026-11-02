const HEALTH_HEADERS = { "Cache-Control": "no-store, max-age=0" };

/**
 * The container's health check. Deliberately outside the request logging (logging plan, L2): no
 * request context, no `request` line and no `x-request-id`, because Docker calls it every few seconds.
 */
export function GET() {
  return Response.json({ status: "ok" }, { headers: HEALTH_HEADERS });
}

const HEALTH_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export function GET() {
  return Response.json({ status: "ok" }, { headers: HEALTH_HEADERS });
}

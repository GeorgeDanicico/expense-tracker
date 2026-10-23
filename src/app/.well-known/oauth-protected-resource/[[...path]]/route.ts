import { mcpOrigin, protectedResourceMetadata } from "@/lib/mcp/oauth-spike";

// [p1-spike] Serves /.well-known/oauth-protected-resource and .../api/mcp (RFC 9728).
export async function GET(request: Request) {
  console.log("[p1-spike] protected-resource metadata requested", { path: new URL(request.url).pathname });
  return Response.json(protectedResourceMetadata(mcpOrigin(request)), {
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

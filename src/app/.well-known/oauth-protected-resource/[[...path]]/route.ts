import { mcpProtectedResourceMetadata, mcpResourceOrigin } from "@/lib/mcp/authorization-server";

/**
 * The protected-resource file (RFC 9728) that tells MCP clients where to get a token for `/api/mcp`.
 * Served at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`;
 * any other path under it is a 404. Public: it holds no user data.
 */
export async function GET(request: Request, { params }: RouteContext<"/.well-known/oauth-protected-resource/[[...path]]">) {
  const { path } = await params;
  if (path !== undefined && path.join("/") !== "api/mcp") {
    return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(mcpProtectedResourceMetadata(mcpResourceOrigin(request)), {
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

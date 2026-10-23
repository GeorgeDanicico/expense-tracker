import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import { json, PRIVATE_HEADERS } from "@/lib/http/route";
import { authenticateMcpRequest, type McpAuthorization, readMcpAuthorization } from "@/lib/mcp/auth";
import { mcpBearerChallenge, mcpResourceOrigin } from "@/lib/mcp/authorization-server";
import { createMcpServer } from "@/lib/mcp/server";

// AsyncLocalStorage (the session's run) and node:crypto (auth) need the Node runtime.
export const runtime = "nodejs";

const BASIC_CHALLENGE = 'Basic realm="expense-tracker"';
const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isAllowedOrigin(origin: string) {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const siteUrl = process.env.SITE_URL;
  if (siteUrl) {
    try {
      return parsed.origin === new URL(siteUrl).origin;
    } catch {
      return false;
    }
  }
  return LOCALHOST_NAMES.has(parsed.hostname) || parsed.hostname.endsWith(".localhost");
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

function withPrivateHeaders(response: Response) {
  try {
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(key, value);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

/**
 * The 401's challenges: `Bearer` for a token, `Basic` for a password, and both when the request sent
 * neither, `Bearer` first since MCP clients read `resource_metadata` from the first one.
 */
function challengeHeaders(authorization: McpAuthorization, request: Request) {
  const headers = new Headers();
  if (authorization.kind !== "basic") headers.append("WWW-Authenticate", mcpBearerChallenge(mcpResourceOrigin(request)));
  if (authorization.kind === "basic" || authorization.kind === "none") headers.append("WWW-Authenticate", BASIC_CHALLENGE);
  return headers;
}

async function handle(request: Request) {
  // MCP spec DNS-rebinding guard. Claude Code and mcp-remote send no Origin.
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin)) {
    return json({ error: "Forbidden" }, 403);
  }

  const authorization = readMcpAuthorization(request);
  const auth = await authenticateMcpRequest(authorization, clientIp(request));
  if (auth.status === "throttled") {
    return json({ error: "Too many failed attempts. Try again later." }, 429);
  }
  if (auth.status === "forbidden") {
    return json({ error: auth.message }, 403);
  }
  if (auth.status === "unavailable") {
    // A 503, not a 401, so the client retries instead of discarding a valid token.
    return json(
      { error: "Couldn't open a session for this token. Try again shortly." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
  if (auth.status !== "ok") {
    return json({ error: "Unauthorized" }, { status: 401, headers: challengeHeaders(authorization, request) });
  }

  // Stateless mode has no standalone SSE stream or session to delete. The raw transport would
  // otherwise hold a GET stream open indefinitely, so answer like the SDK's stateless fallback.
  if (request.method !== "POST") {
    return json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const { session } = auth;
  const server = createMcpServer({ userId: session.userId, email: session.email });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const response = await session.run(() => transport.handleRequest(request));
  return withPrivateHeaders(response);
}

export { handle as DELETE, handle as GET, handle as POST };

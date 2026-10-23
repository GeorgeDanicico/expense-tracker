import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import { type AuthSession, spikeSessionForAppToken } from "@/lib/auth";
import { json, PRIVATE_HEADERS } from "@/lib/http/route";
import { getMcpSession, parseBasicCredentials } from "@/lib/mcp/auth";
import { bearerChallenge, mcpOrigin } from "@/lib/mcp/oauth-spike";
import { createMcpServer } from "@/lib/mcp/server";

// AsyncLocalStorage (the session's run) and node:crypto (auth) need the Node runtime.
export const runtime = "nodejs";

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

async function handle(request: Request) {
  // MCP spec DNS-rebinding guard. Claude Code and mcp-remote send no Origin.
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin)) {
    return json({ error: "Forbidden" }, 403);
  }

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  let session: AuthSession;
  if (bearer) {
    // [p1-spike] The OAuth path: a Supabase OAuth access token.
    const appSession = await spikeSessionForAppToken(bearer);
    if (!appSession) {
      return json(
        { error: "Unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": bearerChallenge(mcpOrigin(request)) } },
      );
    }
    console.log("[p1-spike] /api/mcp OAuth request ok", { userId: appSession.userId });
    session = appSession;
  } else {
    const credentials = parseBasicCredentials(request);
    const auth = credentials ? await getMcpSession(credentials, clientIp(request)) : { status: "unauthorized" as const };
    if (auth.status === "throttled") {
      return json({ error: "Too many failed attempts. Try again later." }, 429);
    }
    if (auth.status !== "ok") {
      const headers = new Headers();
      // Bearer first: MCP clients read the first challenge's scheme to find resource_metadata.
      if (!authorization) headers.append("WWW-Authenticate", bearerChallenge(mcpOrigin(request)));
      headers.append("WWW-Authenticate", 'Basic realm="expense-tracker"');
      return json({ error: "Unauthorized" }, { status: 401, headers });
    }
    session = auth.session;
  }

  // Stateless mode has no standalone SSE stream or session to delete. The raw transport would
  // otherwise hold a GET stream open indefinitely, so answer like the SDK's stateless fallback.
  if (request.method !== "POST") {
    return json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const server = createMcpServer({ userId: session.userId, email: session.email });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const response = await session.run(() => transport.handleRequest(request));
  return withPrivateHeaders(response);
}

export { handle as DELETE, handle as GET, handle as POST };

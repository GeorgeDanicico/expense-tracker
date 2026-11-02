import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import { getEnv } from "@/lib/env";
import { clientKey } from "@/lib/http/client-ip";
import { mcpIpRequests, mcpUserRequests, TOO_MANY_REQUESTS } from "@/lib/http/rate-limit";
import { logRequest } from "@/lib/http/request-log";
import { json, PRIVATE_HEADERS, tooManyRequests } from "@/lib/http/route";
import { setRequestUser } from "@/lib/log/request-context";
import { authenticateMcpRequest, readMcpAuthorization } from "@/lib/mcp/auth";
import { mcpBearerChallenge, mcpResourceOrigin } from "@/lib/mcp/authorization-server";
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

  const siteUrl = getEnv().SITE_URL;
  if (siteUrl) {
    try {
      return parsed.origin === new URL(siteUrl).origin;
    } catch {
      return false;
    }
  }
  return LOCALHOST_NAMES.has(parsed.hostname) || parsed.hostname.endsWith(".localhost");
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

  // Every request counts per client IP before its token is looked at: a valid app token still costs
  // the auth provider two calls. Bad tokens have their own, much lower limit in `authenticateMcpRequest`.
  const ip = clientKey(request);
  const ipWait = mcpIpRequests.take(ip);
  if (ipWait > 0) return tooManyRequests(TOO_MANY_REQUESTS, ipWait);

  const auth = await authenticateMcpRequest(readMcpAuthorization(request), ip);
  if (auth.status === "throttled") {
    return tooManyRequests("Too many failed attempts. Try again later.", auth.retryAfterSeconds);
  }
  if (auth.status === "forbidden") {
    return json(auth.code ? { error: auth.message, code: auth.code } : { error: auth.message }, 403);
  }
  if (auth.status === "unavailable") {
    // A 503, not a 401, so the client retries instead of discarding a valid token.
    return json(
      { error: "Couldn't open a session for this token. Try again shortly." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
  if (auth.status !== "ok") {
    // Only the Bearer challenge, whatever the request sent (Basic included): its `resource_metadata`
    // is how an MCP client finds the authorization server.
    return json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": mcpBearerChallenge(mcpResourceOrigin(request)) } },
    );
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
  setRequestUser(session.userId);
  const userWait = mcpUserRequests.take(session.userId);
  if (userWait > 0) return tooManyRequests(TOO_MANY_REQUESTS, userWait);

  const server = createMcpServer({ userId: session.userId, email: session.email });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const response = await session.run(() => transport.handleRequest(request));
  return withPrivateHeaders(response);
}

/**
 * Every MCP request runs in its own request context and writes one `request` line, with an
 * `x-request-id` on the response (`logRequest`): the proxy skips this route, so the id is always new.
 */
function route(request: Request) {
  return logRequest(request, () => handle(request));
}

export { route as DELETE, route as GET, route as POST };

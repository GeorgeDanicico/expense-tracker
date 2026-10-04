import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { NextResponse } from "next/server";

import { getMcpSession, parseBasicCredentials } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";
import { runWithSupabaseClient } from "@/lib/supabase/server";

// AsyncLocalStorage (runWithSupabaseClient) and node:crypto (auth) need the Node runtime.
export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }

  const credentials = parseBasicCredentials(request);
  const auth = credentials ? await getMcpSession(credentials, clientIp(request)) : { status: "unauthorized" as const };
  if (auth.status === "throttled") {
    return NextResponse.json({ error: "Too many failed attempts. Try again later." }, { status: 429, headers: PRIVATE_HEADERS });
  }
  if (auth.status !== "ok") {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { ...PRIVATE_HEADERS, "WWW-Authenticate": 'Basic realm="expense-tracker"' } },
    );
  }

  // Stateless mode has no standalone SSE stream or session to delete. The raw transport would
  // otherwise hold a GET stream open indefinitely, so answer like the SDK's stateless fallback.
  if (request.method !== "POST") {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "POST" } },
    );
  }

  const { session } = auth;
  const server = createMcpServer({ userId: session.userId, email: session.email });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const response = await runWithSupabaseClient(session.client, () => transport.handleRequest(request));
  return withPrivateHeaders(response);
}

export { handle as DELETE, handle as GET, handle as POST };

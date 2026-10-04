import { AsyncLocalStorage } from "node:async_hooks";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseBasicCredentials: vi.fn(),
  getMcpSession: vi.fn(),
  createMcpServer: vi.fn(),
  runWithSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/mcp/auth", () => ({
  parseBasicCredentials: mocks.parseBasicCredentials,
  getMcpSession: mocks.getMcpSession,
}));
vi.mock("@/lib/mcp/server", () => ({ createMcpServer: mocks.createMcpServer }));
vi.mock("@/lib/supabase/server", () => ({ runWithSupabaseClient: mocks.runWithSupabaseClient }));

import { McpServer } from "@modelcontextprotocol/server";

import { DELETE, GET, POST } from "@/app/api/mcp/route";

const scope = new AsyncLocalStorage<{ name: string }>();
const client = { name: "session-client" };
const session = { client, userId: "10000000-0000-4000-8000-000000000041", email: "user@example.com" };
const credentials = { email: session.email, password: "correct-horse" };

function buildServer() {
  const server = new McpServer({ name: "expense-tracker", version: "test" });
  server.registerTool("whoami", { description: "Returns the scoped client name." }, async () => ({
    content: [{ type: "text", text: scope.getStore()?.name ?? "unscoped" }],
  }));
  return server;
}

function rpc(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Request("http://localhost/api/mcp", {
    method,
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Authorization: "Basic dGVzdA==",
      "MCP-Protocol-Version": "2025-06-18",
      ...headers,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1.0.0" } },
};

function sseMessages(text: string) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line.length > 6)
    .map((line) => JSON.parse(line.slice(6)));
}

describe("/api/mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SITE_URL", "https://expenses.example.com");
    mocks.parseBasicCredentials.mockReturnValue(credentials);
    mocks.getMcpSession.mockResolvedValue({ status: "ok", session });
    mocks.createMcpServer.mockImplementation(buildServer);
    mocks.runWithSupabaseClient.mockImplementation((scopedClient: { name: string }, fn: () => unknown) =>
      scope.run(scopedClient, fn),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 with a Basic challenge when credentials are missing", async () => {
    mocks.parseBasicCredentials.mockReturnValue(null);
    const response = await POST(rpc(initialize, { Authorization: "" }));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="expense-tracker"');
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.getMcpSession).not.toHaveBeenCalled();
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("returns 401 when the credentials are rejected", async () => {
    mocks.getMcpSession.mockResolvedValue({ status: "unauthorized" });
    const response = await POST(rpc(initialize));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="expense-tracker"');
  });

  it("returns 429 when sign-in is throttled", async () => {
    mocks.getMcpSession.mockResolvedValue({ status: "throttled" });
    const response = await POST(rpc(initialize));

    expect(response.status).toBe(429);
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("passes the first forwarded IP to the session lookup", async () => {
    mocks.getMcpSession.mockResolvedValue({ status: "unauthorized" });
    await POST(rpc(initialize, { "X-Forwarded-For": "203.0.113.7, 10.0.0.1", "X-Real-IP": "10.0.0.2" }));
    await POST(rpc(initialize, { "X-Real-IP": "10.0.0.2" }));
    await POST(rpc(initialize));

    expect(mocks.getMcpSession.mock.calls.map((call) => call[1])).toEqual(["203.0.113.7", "10.0.0.2", null]);
  });

  it("returns 403 for a foreign Origin before checking credentials", async () => {
    const response = await POST(rpc(initialize, { Origin: "https://evil.example" }));

    expect(response.status).toBe(403);
    expect(mocks.parseBasicCredentials).not.toHaveBeenCalled();
    expect(mocks.getMcpSession).not.toHaveBeenCalled();
  });

  it("allows the configured site Origin", async () => {
    const response = await POST(rpc(initialize, { Origin: "https://expenses.example.com" }));
    expect(response.status).toBe(200);
  });

  it("allows only localhost origins when SITE_URL is not configured", async () => {
    vi.stubEnv("SITE_URL", "");
    expect((await POST(rpc(initialize, { Origin: "http://localhost:3000" }))).status).toBe(200);
    expect((await POST(rpc(initialize, { Origin: "https://expenses.example.com" }))).status).toBe(403);
  });

  it("answers initialize over the streaming transport with private cache headers", async () => {
    const response = await POST(rpc(initialize));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const [message] = sseMessages(await response.text());
    expect(message).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "expense-tracker", version: "test" } },
    });
    expect(mocks.createMcpServer).toHaveBeenCalledWith({ userId: session.userId, email: session.email });
  });

  it("runs tool calls inside the session's Supabase client scope", async () => {
    const response = await POST(
      rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    );

    expect(response.status).toBe(200);
    expect(mocks.runWithSupabaseClient).toHaveBeenCalledWith(client, expect.any(Function));
    const [message] = sseMessages(await response.text());
    expect(message.result.content).toEqual([{ type: "text", text: "session-client" }]);
  });

  it("rejects GET and DELETE with 405 in stateless mode", async () => {
    for (const handler of [GET, DELETE]) {
      const response = await handler(rpc(undefined, {}, handler === GET ? "GET" : "DELETE"));
      expect(response.status).toBe(405);
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    }
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });
});

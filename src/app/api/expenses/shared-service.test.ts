import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { anExpense } from "@/test/builders";
import { resetFakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/expenses/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/expenses/service")>();
  return { ...actual, createExpense: vi.fn(actual.createExpense), updateExpense: vi.fn(actual.updateExpense) };
});

import { PATCH } from "@/app/api/expenses/[id]/route";
import { POST } from "@/app/api/expenses/route";
import { createExpense, updateExpense } from "@/lib/expenses/service";
import { createMcpServer } from "@/lib/mcp/server";

// Audit D10: REST and MCP write expenses through the same use cases, so the rules can't drift. The
// expense's own date decides its month on both: neither asks for a month to match.

const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const fuel = { description: "Fuel", amount: "10.50", category: "car", subtype: "car_fuel", expenseDate: "2025-01-31" };

async function callTool(userId: string, name: string, args: Record<string, unknown>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([createMcpServer({ userId, email: "owner@example.com" }).connect(serverTransport), client.connect(clientTransport)]);
  return client.callTool({ name, arguments: args });
}

describe("expense writes over REST and MCP", () => {
  let user: ReturnType<typeof signedInAs>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = signedInAs();
    resetFakeRepositories().expenses.expenses.set(user.id, [anExpense({ id: ID, expenseDate: "2026-10-04" })]);
  });

  it("creates through createExpense from both, with the same input for the same request", async () => {
    const rest = await callRoute(POST, { method: "POST", url: "/api/expenses", body: fuel });
    const mcp = await callTool(user.id, "add_expense", fuel);

    expect(rest.status).toBe(201);
    expect(mcp.isError).toBeFalsy();
    expect(vi.mocked(createExpense)).toHaveBeenCalledTimes(2);
    const [[restUser, restInput], [mcpUser, mcpInput]] = vi.mocked(createExpense).mock.calls;
    expect(restUser).toBe(user.id);
    expect(mcpUser).toBe(user.id);
    expect(restInput).toEqual(mcpInput);
    expect(restInput.expenseDate).toBe("2025-01-31");
  });

  it("updates through updateExpense from both", async () => {
    const rest = await callRoute(PATCH, { method: "PATCH", url: `/api/expenses/${ID}`, params: { id: ID }, body: { expenseDate: "2025-01-31" } });
    const mcp = await callTool(user.id, "update_expense", { id: ID, amount: 12 });

    expect(rest.status).toBe(200);
    expect(mcp.isError).toBeFalsy();
    expect(vi.mocked(updateExpense).mock.calls).toEqual([
      [user.id, ID, { expenseDate: "2025-01-31" }],
      [user.id, ID, { amount: 12 }],
    ]);
  });
});

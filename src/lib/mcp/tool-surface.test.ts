import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { createMcpServer } from "@/lib/mcp/server";

// Characterization test: the tool surface Claude sees must not change by accident.
// Update the snapshot only for an intended change to a tool's contract.
describe("MCP tool surface", () => {
  it("lists the same tools, schemas and annotations", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ userId: "owner", email: "owner@example.com" });
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const surface = tools.map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations,
    }));

    expect(surface).toMatchSnapshot();
  });
});

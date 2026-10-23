import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MCP_TOKEN_EXPIRY,
  MCP_TOKEN_EXPIRIES,
  MCP_TOKEN_EXPIRY_LABELS,
  generateMcpToken,
  hashMcpToken,
  parseMcpToken,
} from "@/lib/mcp/tokens";

describe("MCP token helpers", () => {
  it("generates sl_mcp_ and 43 base64url characters, with its display prefix and hash", () => {
    const { token, prefix, hash } = generateMcpToken();

    expect(token).toMatch(/^sl_mcp_[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(token.slice(0, 13));
    expect(prefix).toMatch(/^sl_mcp_[A-Za-z0-9_-]{6}$/);
    expect(hash).toBe(hashMcpToken(token));
  });

  it("generates a different token every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateMcpToken().token));

    expect(tokens.size).toBe(50);
  });

  it("hashes the whole token as lowercase hex SHA-256", () => {
    const token = `sl_mcp_${"a".repeat(43)}`;

    expect(hashMcpToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashMcpToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses a generated token", () => {
    const { token } = generateMcpToken();

    expect(parseMcpToken(token)).toBe(token);
    expect(parseMcpToken(`sl_mcp_${"-_".repeat(21)}Z`)).not.toBeNull();
  });

  it.each([
    ["an empty value", ""],
    ["the prefix alone", "sl_mcp_"],
    ["a short secret", `sl_mcp_${"a".repeat(42)}`],
    ["a long secret", `sl_mcp_${"a".repeat(44)}`],
    ["another prefix", `sl_xyz_${"a".repeat(43)}`],
    ["a character outside base64url", `sl_mcp_${"a".repeat(42)}+`],
    ["padding", `sl_mcp_${"a".repeat(42)}=`],
    ["surrounding space", ` sl_mcp_${"a".repeat(43)}`],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
  ])("refuses %s", (_, value) => {
    expect(parseMcpToken(value)).toBeNull();
  });

  it("lists the four expiries, defaulting to 3 months, each with a label", () => {
    expect(MCP_TOKEN_EXPIRIES).toEqual(["1m", "3m", "6m", "never"]);
    expect(DEFAULT_MCP_TOKEN_EXPIRY).toBe("3m");
    expect(MCP_TOKEN_EXPIRY_LABELS).toEqual({ "1m": "1 month", "3m": "3 months", "6m": "6 months", never: "Never" });
  });
});

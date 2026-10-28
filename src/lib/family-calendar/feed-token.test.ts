import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { feedPath, feedWebcalUrl } from "@/lib/family-calendar/feed-link";
import { generateFeedToken, hashFeedToken, parseFeedToken } from "@/lib/family-calendar/feed-token";

describe("calendar feed tokens", () => {
  it("generates sl_cal_ and 43 base64url characters, with its hash", () => {
    const { token, hash } = generateFeedToken();

    expect(token).toMatch(/^sl_cal_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashFeedToken(token));
  });

  it("generates a different token every time", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateFeedToken().token)).size).toBe(50);
  });

  it("hashes the whole token as lowercase hex SHA-256", () => {
    const token = `sl_cal_${"A".repeat(43)}`;

    expect(hashFeedToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashFeedToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads the token from a path segment, with or without .ics", () => {
    const { token } = generateFeedToken();

    expect(parseFeedToken(`${token}.ics`)).toBe(token);
    expect(parseFeedToken(token)).toBe(token);
  });

  it("refuses anything that isn't the shape of a token", () => {
    const body = "A".repeat(43);

    for (const value of ["", ".ics", `sl_mcp_${body}`, `sl_cal_${body.slice(1)}`, `sl_cal_${body}A`, `sl_cal_${body.slice(1)}!`, `${`sl_cal_${body}`}.ics.ics`, ` sl_cal_${body}`]) {
      expect(parseFeedToken(value)).toBeNull();
    }
  });
});

describe("the feed link", () => {
  const token = `sl_cal_${"A".repeat(43)}`;

  it("ends in the token and .ics", () => {
    expect(feedPath(token)).toBe(`/api/calendar/feed/${token}.ics`);
  });

  it("is a webcal:// link on the origin the page was opened from", () => {
    expect(feedWebcalUrl("https://ledger.example.ts.net", token)).toBe(`webcal://ledger.example.ts.net/api/calendar/feed/${token}.ics`);
    expect(feedWebcalUrl("http://100.64.0.7:3000", token)).toBe(`webcal://100.64.0.7:3000/api/calendar/feed/${token}.ics`);
  });

  it("parses back from its own path", () => {
    expect(parseFeedToken(feedPath(token).split("/").at(-1)!)).toBe(token);
  });
});

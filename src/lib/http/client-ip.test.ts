import { describe, expect, it } from "vitest";

import { clientIp } from "@/lib/http/client-ip";

function request(headers: Record<string, string>) {
  return new Request("http://localhost/api/auth", { headers });
}

describe("clientIp", () => {
  it("takes the last X-Forwarded-For hop, the one our own proxy added", () => {
    expect(clientIp(request({ "x-forwarded-for": "198.51.100.9, 10.0.0.1 , 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("takes a single X-Forwarded-For address", () => {
    expect(clientIp(request({ "x-forwarded-for": " 203.0.113.7 " }))).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is missing or its last hop is empty", () => {
    expect(clientIp(request({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7, ", "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
  });

  it("answers null when the request names no address", () => {
    expect(clientIp(request({}))).toBeNull();
    expect(clientIp(request({ "x-forwarded-for": " " }))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";
import { COOP_EXEMPTIONS, STATIC_SECURITY_HEADERS, strictTransportSecurity } from "@/lib/http/security-headers";

describe("strictTransportSecurity", () => {
  it("is one year, without includeSubDomains or preload, for an https SITE_URL", () => {
    expect(strictTransportSecurity("https://ledger.tailnet.ts.net")).toBe("max-age=31536000");
    expect(strictTransportSecurity("https://ledger.tailnet.ts.net/")).toBe("max-age=31536000");
  });

  it("is never sent for http, a missing SITE_URL or one that isn't a URL", () => {
    expect(strictTransportSecurity("http://localhost:3000")).toBeNull();
    expect(strictTransportSecurity(undefined)).toBeNull();
    expect(strictTransportSecurity("")).toBeNull();
    expect(strictTransportSecurity("not a url")).toBeNull();
  });
});

describe("next.config.ts headers", () => {
  async function headersFor(source: string) {
    const rules = (await nextConfig.headers?.()) ?? [];
    return rules.find((rule) => rule.source === source)?.headers ?? [];
  }

  it("sends the static security headers on every path, the existing ones included", async () => {
    const headers = Object.fromEntries((await headersFor("/:path*")).map(({ key, value }) => [key, value]));
    expect(headers).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    expect(STATIC_SECURITY_HEADERS).toHaveLength(6);
  });

  it("leaves HSTS and the CSP to the proxy: next.config headers are fixed at build time", async () => {
    const keys = ((await nextConfig.headers?.()) ?? []).flatMap((rule) => rule.headers.map(({ key }) => key.toLowerCase()));
    expect(keys).not.toContain("strict-transport-security");
    expect(keys.some((key) => key.startsWith("content-security-policy"))).toBe(false);
  });

  it("relaxes COOP only on the exempted paths, each with a reason, after the general rule", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const general = rules.findIndex((rule) => rule.source === "/:path*");
    for (const [path, reason] of Object.entries(COOP_EXEMPTIONS)) {
      expect(reason.length).toBeGreaterThan(20);
      const index = rules.findIndex((rule) => rule.source === path);
      expect(index).toBeGreaterThan(general); // Next lets the later rule win.
      expect(rules[index].headers).toEqual([{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }]);
    }
    expect(Object.keys(COOP_EXEMPTIONS)).toEqual(["/oauth/consent"]);
  });

  it("keeps the service worker's own headers", async () => {
    expect(await headersFor("/sw.js")).toEqual([
      { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
    ]);
  });
});

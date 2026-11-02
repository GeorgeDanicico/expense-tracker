import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { redactPath } from "@/lib/log/redact-path";
import { routeTemplate } from "@/lib/log/route-template";

const UUID = "6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";

describe("routeTemplate", () => {
  it("replaces UUID segments, in any case, with :id", () => {
    expect(routeTemplate(`/api/expenses/${UUID}`)).toBe("/api/expenses/:id");
    expect(routeTemplate(`/api/net-worth/items/${UUID.toUpperCase()}/valuations`)).toBe("/api/net-worth/items/:id/valuations");
    expect(routeTemplate(`/api/avatars/${UUID}/${UUID}`)).toBe("/api/avatars/:id/:id");
  });

  it("drops the query string and fragment", () => {
    expect(routeTemplate("/api/expenses?month=2026-11&email=a@b.test#x")).toBe("/api/expenses");
  });

  it("names the calendar feed's token, an invite code and the OAuth ids by their place", () => {
    expect(routeTemplate(`/api/calendar/feed/sl_cal_${"A".repeat(43)}.ics`)).toBe("/api/calendar/feed/:token");
    expect(routeTemplate("/api/calendar/feed/short")).toBe("/api/calendar/feed/:token");
    expect(routeTemplate("/join/ABCD2345")).toBe("/join/:code");
    expect(routeTemplate("/api/oauth/authorizations/abc123/approve")).toBe("/api/oauth/authorizations/:id/approve");
    expect(routeTemplate("/api/account/mcp/apps/my-app")).toBe("/api/account/mcp/apps/:clientId");
  });

  it("leaves the routes next to those alone", () => {
    expect(routeTemplate("/api/calendar/feed-link")).toBe("/api/calendar/feed-link");
    expect(routeTemplate("/api/account/mcp/apps")).toBe("/api/account/mcp/apps");
    expect(routeTemplate("/api/oauth/authorizations")).toBe("/api/oauth/authorizations");
  });

  it("replaces any long segment, or a mix of 16 or more letters and digits, with :value", () => {
    expect(routeTemplate(`/api/things/${"x".repeat(25)}`)).toBe("/api/things/:value");
    expect(routeTemplate("/api/things/a1b2c3d4e5f6a7b8")).toBe("/api/things/:value");
    expect(routeTemplate("/api/things/abcdefghijklmnop")).toBe("/api/things/abcdefghijklmnop");
    expect(routeTemplate("/api/investment-transactions")).toBe("/api/investment-transactions");
  });

  it("keeps a placeholder only where a rule put it, not one the client typed", () => {
    expect(routeTemplate(`/api/things/:${"x".repeat(30)}`)).toBe("/api/things/:value");
  });
});

describe("redactPath", () => {
  it("replaces an invite link's code and leaves other paths alone", () => {
    expect(redactPath("/join/ABCD2345")).toBe("/join/:code");
    expect(redactPath("/join/ABCD2345/extra")).toBe("/join/:code/extra");
    expect(redactPath("/dashboard")).toBe("/dashboard");
  });
});

describe("the template of every route", () => {
  const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));
  const routeDirs = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.split(sep).at(-1) === "route.ts")
    .map((file) => relative(APP_DIR, join(APP_DIR, file, "..")).split(sep).join("/"))
    .filter((dir) => dir !== "health")
    .sort();

  /**
   * Realistic values for each dynamic segment, by its name; a new segment name needs samples here.
   * Routes that check their id is a UUID (`parseId`) only ever act on UUIDs; anything else is a 400
   * whose path is no one's id.
   */
  const SAMPLES: Record<string, string[]> = {
    id: [UUID],
    userId: [UUID],
    file: [UUID],
    token: [`sl_cal_${"A".repeat(43)}.ics`, `sl_cal_${"A".repeat(43)}`],
    clientId: [UUID, "claude-desktop", "k9"],
  };
  /** Supabase's OAuth authorization ids are URL-safe tokens of any length (`isAuthorizationId`), not UUIDs. */
  const OAUTH_AUTHORIZATION_IDS = [UUID, "abc123", "Zx9-_Kq"];
  const samplesFor = (dir: string, name: string) =>
    dir.startsWith("api/oauth/authorizations/") && name === "id" ? OAUTH_AUTHORIZATION_IDS : SAMPLES[name];

  /** Every sample path of a route dir, each with the values that must not reach the template. */
  function samplePaths(dir: string): { path: string; values: string[] }[] {
    let paths = [{ path: "", values: [] as string[] }];
    for (const segment of dir.split("/").filter((part) => !/^\(.*\)$/.test(part))) {
      const optionalCatchAll = segment.match(/^\[\[\.\.\.(\w+)\]\]$/);
      const dynamic = segment.match(/^\[(\w+)\]$/);
      if (optionalCatchAll) {
        // The only catch-all is the OAuth metadata's, which serves `api/mcp` and nothing else.
        paths = paths.flatMap(({ path, values }) => [{ path, values }, { path: `${path}/api/mcp`, values }]);
      } else if (dynamic) {
        const samples = samplesFor(dir, dynamic[1]);
        expect(samples, `samples for [${dynamic[1]}] in ${dir}`).toBeDefined();
        paths = paths.flatMap(({ path, values }) => samples.map((sample) => ({ path: `${path}/${sample}`, values: [...values, sample] })));
      } else {
        paths = paths.map(({ path, values }) => ({ path: `${path}/${segment}`, values }));
      }
    }
    return paths;
  }

  /** The template a route dir must have: its static segments as they are and a `:name` for each dynamic one. */
  function expectedTemplate(dir: string): RegExp {
    const parts = dir.split("/").map((segment) => {
      if (/^\[\[\.\.\./.test(segment)) return "(?:/api/mcp)?";
      if (/^\[\w+\]$/.test(segment)) return "/:[A-Za-z]+";
      return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
    });
    return new RegExp(`^${parts.join("")}$`);
  }

  it("finds the routes", () => {
    expect(routeDirs).toContain("api/expenses/[id]");
    expect(routeDirs).toContain("api/mcp");
    expect(routeDirs.length).toBeGreaterThan(60);
  });

  it.each(routeDirs)("%s maps to a template with no raw ids", (dir) => {
    for (const { path, values } of samplePaths(dir)) {
      const template = routeTemplate(path);
      expect(template, path).toMatch(expectedTemplate(dir));
      for (const value of values) expect(template, path).not.toContain(value);
    }
  });
});

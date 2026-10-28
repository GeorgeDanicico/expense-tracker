import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateFeedToken, hashFeedToken } from "@/lib/family-calendar/feed-token";
import type { CalendarFeedEvent } from "@/lib/family-calendar/feed-repository";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { parseICalendar } from "@/test/ics";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), cookies: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.cookies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/calendar/feed/[token]/route";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const event = (id: string, title: string, fields: Partial<CalendarFeedEvent> = {}): CalendarFeedEvent => ({
  id,
  title,
  notes: "",
  location: "",
  allDay: false,
  startsAt: "2026-11-03T07:00:00.000Z",
  endsAt: "2026-11-03T08:00:00.000Z",
  timezone: "Europe/Bucharest",
  updatedAt: "2026-10-28T09:00:00.000Z",
  ...fields,
});

/** A live link whose owner's feed is `contents` (what `calendar_feed()` would work out from their events). */
async function linkWith(contents?: { familyName: string | null; events: CalendarFeedEvent[] }) {
  const { token, hash } = generateFeedToken();
  await repositories.calendarFeeds.create(hash);
  if (contents) repositories.calendarFeeds.contents.set(hash, contents);
  return token;
}

async function fetchFeed(segment: string) {
  const request = new Request(`http://localhost/api/calendar/feed/${segment}`, { headers: { cookie: "sb-access-token=session" } });
  const response = await GET(request, { params: Promise.resolve({ token: segment }) });
  return { response, status: response.status, text: await response.text() };
}

describe("GET /api/calendar/feed/[token]", () => {
  it("serves the owner's events as an iCalendar file", async () => {
    const token = await linkWith({ familyName: "The Danicicos", events: [event("e1", "Swimming", { location: "Olympic pool" })] });
    const { response, status, text } = await fetchFeed(`${token}.ics`);

    expect(status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    const calendar = parseICalendar(text);
    expect(calendar.properties["X-WR-CALNAME"].value).toBe("The Danicicos");
    expect(calendar.events.map((read) => [read.UID.value, read.SUMMARY.value, read.LOCATION.value])).toEqual([
      ["e1@simple-ledger", "Swimming", "Olympic pool"],
    ]);
  });

  it("also answers without the .ics ending", async () => {
    const token = await linkWith({ familyName: "The Danicicos", events: [event("e1", "Swimming")] });

    expect((await fetchFeed(token)).status).toBe(200);
  });

  it("renders whatever the database returned, so a kid's feed holds only their events", async () => {
    // Which events a feed holds, "only the ones the owner attends", is decided and tested in
    // calendar_feed() itself (supabase/tests/calendar_feeds.sql). The route adds nothing and removes
    // nothing: each link shows exactly what its own read returned.
    const kid = await linkWith({ familyName: "The Danicicos", events: [event("e-shared", "Family lunch")] });
    // The fake models one signed-in user (`create` revokes its live link), so the parent's is put in directly.
    const parentToken = generateFeedToken();
    repositories.calendarFeeds.feeds.push({
      id: "f-parent", tokenHash: parentToken.hash, createdAt: "2026-10-28T09:00:00Z", lastFetchedAt: null, revokedAt: null,
    });
    repositories.calendarFeeds.contents.set(parentToken.hash, {
      familyName: "The Danicicos",
      events: [event("e-parent", "Board meeting"), event("e-shared", "Family lunch")],
    });
    const parent = parentToken.token;

    const ids = async (token: string) => parseICalendar((await fetchFeed(`${token}.ics`)).text).events.map((read) => read.UID.value);
    expect(await ids(parent)).toEqual(["e-parent@simple-ledger", "e-shared@simple-ledger"]);
    expect(await ids(kid)).toEqual(["e-shared@simple-ledger"]);
  });

  it("is an empty calendar once the owner has left their family", async () => {
    const token = await linkWith({ familyName: null, events: [] });
    const { status, text } = await fetchFeed(`${token}.ics`);

    expect(status).toBe(200);
    const calendar = parseICalendar(text);
    expect(calendar.events).toEqual([]);
    expect(calendar.properties["X-WR-CALNAME"].value).toBe("iFam");
  });

  it("hashes the token before it reaches the repository, which never sees the secret", async () => {
    const token = await linkWith();
    const read = vi.spyOn(repositories.calendarFeeds, "read");
    await fetchFeed(`${token}.ics`);

    expect(read).toHaveBeenCalledExactlyOnceWith(hashFeedToken(token));
    expect(hashFeedToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers an unknown token with a bare 404", async () => {
    const { response, status, text } = await fetchFeed(`${generateFeedToken().token}.ics`);

    expect(status).toBe(404);
    expect(text).toBe("");
    expect(response.headers.get("content-type")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("answers a revoked token with the same bare 404", async () => {
    const token = await linkWith({ familyName: "The Danicicos", events: [event("e1", "Swimming")] });
    await repositories.calendarFeeds.revoke();
    const unknown = await fetchFeed(`${generateFeedToken().token}.ics`);
    const revoked = await fetchFeed(`${token}.ics`);

    expect(revoked.status).toBe(404);
    expect(revoked.text).toBe(unknown.text);
  });

  it("stops the old token the moment a new one is made", async () => {
    const old = await linkWith({ familyName: "The Danicicos", events: [event("e1", "Swimming")] });
    const fresh = await linkWith({ familyName: "The Danicicos", events: [event("e1", "Swimming")] });

    expect((await fetchFeed(`${old}.ics`)).status).toBe(404);
    expect((await fetchFeed(`${fresh}.ics`)).status).toBe(200);
  });

  it.each([
    ["nonsense", "nope.ics"],
    ["empty", ".ics"],
    ["no prefix", `${"A".repeat(43)}.ics`],
    ["another token's prefix", `sl_mcp_${"A".repeat(43)}.ics`],
    ["too short", `sl_cal_${"A".repeat(42)}.ics`],
    ["too long", `sl_cal_${"A".repeat(44)}.ics`],
    ["characters outside base64url", `sl_cal_${"A".repeat(42)}+.ics`],
    ["percent escapes", `sl_cal_${"A".repeat(40)}%41%41%41.ics`],
    ["a trailing newline", `sl_cal_${"A".repeat(43)}\n.ics`],
    ["another extension", `sl_cal_${"A".repeat(43)}.txt`],
    ["a doubled extension", `sl_cal_${"A".repeat(43)}.ics.ics`],
  ])("answers a malformed token (%s) with 404 before touching the database", async (_name, segment) => {
    const { status, text } = await fetchFeed(segment);

    expect(status).toBe(404);
    expect(text).toBe("");
    expect(repositories.calendarFeeds.calls).toEqual([]);
  });

  it("answers 503, not 404, when the database fails, so the calendar app keeps its subscription", async () => {
    const token = await linkWith();
    vi.spyOn(repositories.calendarFeeds, "read").mockRejectedValue(new Error("database down"));
    const { response, status } = await fetchFeed(`${token}.ics`);

    expect(status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("works while the family flag is off: the link is the only gate", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");
    const token = await linkWith({ familyName: "The Danicicos", events: [] });

    expect((await fetchFeed(`${token}.ics`)).status).toBe(200);
  });

  it("never reads cookies, the session or the caller's database client", async () => {
    const token = await linkWith({ familyName: "The Danicicos", events: [event("e1", "Swimming")] });
    const request = new Request(`http://localhost/api/calendar/feed/${token}.ics`, { headers: { cookie: "sb-access-token=session" } });
    await GET(request, { params: Promise.resolve({ token: `${token}.ics` }) });
    await fetchFeed("nope.ics");

    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

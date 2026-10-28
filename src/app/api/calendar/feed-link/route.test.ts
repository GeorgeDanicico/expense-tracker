import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { hashFeedToken } from "@/lib/family-calendar/feed-token";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { parseICalendar } from "@/test/ics";
import { callRoute } from "@/test/route";
import { asKid, asLoner, asParent } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET as getFeed } from "@/app/api/calendar/feed/[token]/route";
import { DELETE, GET, POST } from "@/app/api/calendar/feed-link/route";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  asParent(repositories);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const status = () => callRoute(GET, { url: "/api/calendar/feed-link" });
const make = () => callRoute(POST, { method: "POST", url: "/api/calendar/feed-link" });
const turnOff = () => callRoute(DELETE, { method: "DELETE", url: "/api/calendar/feed-link" });

async function fetchFeed(token: string) {
  const segment = `${token}.ics`;
  const response = await getFeed(new Request(`http://localhost/api/calendar/feed/${segment}`), { params: Promise.resolve({ token: segment }) });
  return response.status;
}

const FEED_KEYS = ["createdAt", "id", "lastFetchedAt"];

describe("GET /api/calendar/feed-link", () => {
  it("says there is no link yet", async () => {
    expect(await status()).toMatchObject({ status: 200, body: { feed: null } });
  });

  it("describes the link once it exists, never its secret or hash", async () => {
    const { body: created } = await make();
    const { status: code, body, headers } = await status();

    expect(code).toBe(200);
    expect(Object.keys(body.feed).sort()).toEqual(FEED_KEYS);
    expect(body.feed).toEqual(created.feed);
    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(JSON.stringify(body)).not.toContain(created.token);
    expect(JSON.stringify(body)).not.toContain(hashFeedToken(created.token));
  });

  it("shows when a calendar app last fetched the feed", async () => {
    const { body: created } = await make();
    expect((await status()).body.feed.lastFetchedAt).toBeNull();

    await fetchFeed(created.token);
    expect((await status()).body.feed.lastFetchedAt).toEqual(expect.any(String));
  });

  it("answers 401 to an anonymous caller and 404 while the family flag is off", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    expect(await status()).toMatchObject({ status: 401, body: { error: "Unauthorized" } });

    asParent(repositories);
    vi.stubEnv("FAMILY_ENABLED", "false");
    expect(await status()).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.calendarFeeds.calls).toEqual([]);
  });
});

describe("POST /api/calendar/feed-link", () => {
  it("makes the link and sends its secret once, with no-store", async () => {
    const { status: code, body, headers } = await make();

    expect(code).toBe(201);
    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(body.token).toMatch(/^sl_cal_[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(body.feed).sort()).toEqual(FEED_KEYS);
    expect(Object.keys(body).sort()).toEqual(["feed", "token"]);
  });

  it("stores only the hash of the secret", async () => {
    const { body } = await make();

    expect(repositories.calendarFeeds.feeds.map((row) => row.tokenHash)).toEqual([hashFeedToken(body.token)]);
    expect(JSON.stringify(repositories.calendarFeeds.feeds)).not.toContain(body.token);
  });

  it("makes a different secret every time", async () => {
    const tokens = new Set((await Promise.all([make(), make(), make()])).map(({ body }) => body.token));

    expect(tokens.size).toBe(3);
  });

  it("serves the new link as a calendar", async () => {
    const { body } = await make();

    expect(await fetchFeed(body.token)).toBe(200);
  });

  it("regenerating makes the old token 404 and the new one work", async () => {
    const { body: first } = await make();
    const { body: second } = await make();

    expect(second.token).not.toBe(first.token);
    expect(await fetchFeed(first.token)).toBe(404);
    expect(await fetchFeed(second.token)).toBe(200);
    expect(repositories.calendarFeeds.feeds.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect((await status()).body.feed.id).toBe(second.feed.id);
  });

  it("answers 401 to an anonymous caller without making anything", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await make()).toMatchObject({ status: 401 });
    expect(repositories.calendarFeeds.feeds).toEqual([]);
  });

  it("keeps a database failure private", async () => {
    vi.spyOn(repositories.calendarFeeds, "create").mockRejectedValue(new Error("relation calendar_feeds does not exist"));

    expect(await make()).toMatchObject({ status: 500, body: { error: "Unable to create your calendar link. Please try again." } });
  });
});

describe("DELETE /api/calendar/feed-link", () => {
  it("turns the link off, and its token 404s", async () => {
    const { body } = await make();

    expect((await turnOff()).status).toBe(204);
    expect(await fetchFeed(body.token)).toBe(404);
    expect((await status()).body.feed).toBeNull();
  });

  it("is fine when there was no link", async () => {
    expect((await turnOff()).status).toBe(204);
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await turnOff()).toMatchObject({ status: 401 });
    expect(repositories.calendarFeeds.calls).toEqual([]);
  });
});

describe("whose link it is", () => {
  it("lets a kid make, see and turn off their own link", async () => {
    asKid(repositories);
    const { status: code, body } = await make();

    expect(code).toBe(201);
    expect(await fetchFeed(body.token)).toBe(200);
    expect((await status()).body.feed.id).toBe(body.feed.id);
    expect((await turnOff()).status).toBe(204);
    expect(await fetchFeed(body.token)).toBe(404);
  });

  it("gives a user without a family a link too: it is an empty calendar", async () => {
    asLoner(repositories);
    expect((await status()).body.feed).toBeNull();
    const { status: code, body } = await make();
    expect(code).toBe(201);

    const segment = `${body.token}.ics`;
    const response = await getFeed(new Request(`http://localhost/api/calendar/feed/${segment}`), { params: Promise.resolve({ token: segment }) });
    expect(response.status).toBe(200);
    expect(parseICalendar(await response.text()).events).toEqual([]);
    expect((await turnOff()).status).toBe(204);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { TEST_ALREADY_SENT } from "@/lib/api/keys";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET as GET_KEY } from "@/app/api/notifications/push-key/route";
import { DELETE as UNSUBSCRIBE, POST as SUBSCRIBE } from "@/app/api/notifications/push-subscriptions/route";
import { GET, PATCH } from "@/app/api/notifications/settings/route";
import { POST as SEND_TEST } from "@/app/api/notifications/test/route";

const otherUser: AuthenticatedUser = { id: "20000000-0000-4000-8000-000000000002", email: "other@example.test" };
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const subscription = (endpoint = ENDPOINT) => ({ endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } });
const DEFAULTS = { pushEnabled: true, remindersEnabled: true, todosEnabled: true, deviceCount: 0 };

let repositories: FakeRepositories;

/** Signs in as `user` for the route wrapper and the fake repository. */
function signIn(user: AuthenticatedUser = testUser) {
  signedInAs(user);
  repositories.notificationSettings.callerId = user.id;
}

const settings = () => callRoute(GET, { url: "/api/notifications/settings" });
const patch = (body: unknown) => callRoute(PATCH, { method: "PATCH", url: "/api/notifications/settings", body });
const subscribe = (body: unknown = subscription()) =>
  callRoute(SUBSCRIBE, { method: "POST", url: "/api/notifications/push-subscriptions", body });
const unsubscribe = (body: unknown = { endpoint: ENDPOINT }) =>
  callRoute(UNSUBSCRIBE, { method: "DELETE", url: "/api/notifications/push-subscriptions", body });
const sendTest = () => callRoute(SEND_TEST, { method: "POST", url: "/api/notifications/test" });
const pushKey = () => callRoute(GET_KEY, { url: "/api/notifications/push-key" });

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  signIn();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/notifications/settings", () => {
  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    expect(await settings()).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
  });

  it("answers the defaults and no devices for a new user, no-store", async () => {
    const response = await settings();

    expect(response).toMatchObject({ status: 200, body: DEFAULTS });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("counts only the caller's devices", async () => {
    await subscribe();
    signIn(otherUser);
    await subscribe(subscription("https://push.example.test/other"));
    await subscribe(subscription("https://push.example.test/other-2"));

    expect((await settings()).body).toMatchObject({ deviceCount: 2 });
    signIn();
    expect((await settings()).body).toMatchObject({ deviceCount: 1 });
  });

  it("answers 500 with a generic message when the settings can't be loaded", async () => {
    vi.spyOn(repositories.notificationSettings, "get").mockRejectedValue(new Error("private failure"));
    expect(await settings()).toMatchObject({ status: 500, body: { error: "Unable to load your notification settings." } });
  });
});

describe("PATCH /api/notifications/settings", () => {
  it("changes only the switches it is sent and answers the settings", async () => {
    expect(await patch({ remindersEnabled: false })).toMatchObject({ status: 200, body: { ...DEFAULTS, remindersEnabled: false } });
    expect(await patch({ pushEnabled: false, todosEnabled: false })).toMatchObject({
      status: 200,
      body: { pushEnabled: false, remindersEnabled: false, todosEnabled: false, deviceCount: 0 },
    });
    expect(repositories.notificationSettings.settings.get(testUser.id)).toEqual({
      pushEnabled: false,
      remindersEnabled: false,
      todosEnabled: false,
    });
  });

  it("changes the caller's own settings only", async () => {
    await patch({ pushEnabled: false });
    signIn(otherUser);
    expect((await settings()).body).toEqual(DEFAULTS);
  });

  it.each([[{}], [{ pushEnabled: "no" }], [{ pushEnabled: true, deviceCount: 3 }], [{ userId: otherUser.id, pushEnabled: false }], ["not json"], [null]])(
    "answers 422 for %j and changes nothing",
    async (body) => {
      expect(await patch(body)).toMatchObject({ status: 422 });
      expect(repositories.notificationSettings.settings.size).toBe(0);
    },
  );
});

describe("POST /api/notifications/push-subscriptions", () => {
  it("registers this browser with its user agent and answers 201 with the device count", async () => {
    const response = await callRoute(SUBSCRIBE, {
      method: "POST",
      url: "/api/notifications/push-subscriptions",
      body: subscription(),
    });

    expect(response).toMatchObject({ status: 201, body: { ...DEFAULTS, deviceCount: 1 } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(repositories.notificationSettings.subscriptions).toEqual([
      { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, userAgent: "", userId: testUser.id },
    ]);
  });

  it("is harmless to call again for the same browser", async () => {
    await subscribe();
    expect(await subscribe()).toMatchObject({ status: 201, body: { deviceCount: 1 } });
  });

  it("moves a browser another account had to the caller", async () => {
    signIn(otherUser);
    await subscribe();
    signIn();

    expect(await subscribe()).toMatchObject({ status: 201, body: { deviceCount: 1 } });
    expect(repositories.notificationSettings.subscriptions.map((device) => device.userId)).toEqual([testUser.id]);
  });

  it.each([
    [{ endpoint: "http://push.example.test/insecure", keys: { p256dh: P256DH, auth: AUTH } }],
    [{ endpoint: "not a url", keys: { p256dh: P256DH, auth: AUTH } }],
    [{ endpoint: `https://push.example.test/${"x".repeat(2048)}`, keys: { p256dh: P256DH, auth: AUTH } }],
    [{ endpoint: ENDPOINT, keys: { p256dh: "", auth: AUTH } }],
    [{ endpoint: ENDPOINT, keys: { p256dh: "has spaces", auth: AUTH } }],
    [{ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: "x".repeat(101) } }],
    [{ endpoint: ENDPOINT }],
    ["not json"],
  ])("answers 422 for %j and registers nothing", async (body) => {
    expect(await subscribe(body)).toMatchObject({ status: 422, body: { error: "Invalid push subscription." } });
    expect(repositories.notificationSettings.subscriptions).toEqual([]);
  });
});

describe("DELETE /api/notifications/push-subscriptions", () => {
  it("removes the caller's subscription and answers the settings", async () => {
    await subscribe();
    await subscribe(subscription("https://push.example.test/laptop"));

    expect(await unsubscribe()).toMatchObject({ status: 200, body: { deviceCount: 1 } });
    expect(repositories.notificationSettings.subscriptions.map((device) => device.endpoint)).toEqual(["https://push.example.test/laptop"]);
  });

  it("answers 200 and changes nothing for an endpoint the caller doesn't have, another user's included", async () => {
    signIn(otherUser);
    await subscribe();
    signIn();

    expect(await unsubscribe()).toMatchObject({ status: 200, body: { deviceCount: 0 } });
    expect(repositories.notificationSettings.subscriptions).toHaveLength(1);
  });

  it.each([[{}], [{ endpoint: "http://insecure.example.test" }], ["not json"]])("answers 422 for %j", async (body) => {
    expect(await unsubscribe(body)).toMatchObject({ status: 422 });
  });
});

describe("GET /api/notifications/push-key", () => {
  it("answers the public VAPID key", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", " BPublicKeyForTests ");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-must-not-leak");

    const response = await pushKey();

    expect(response).toMatchObject({ status: 200, body: { publicKey: "BPublicKeyForTests" } });
    expect(JSON.stringify(response.body)).not.toContain("private-must-not-leak");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("answers 503 while the key isn't configured", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    expect(await pushKey()).toMatchObject({ status: 503, body: { error: "Notifications aren't set up on this server yet." } });
  });
});

describe("POST /api/notifications/test", () => {
  it("queues a test for the caller (202), then says it was a no-op within the minute", async () => {
    let now = Date.parse("2026-10-25T09:00:00.000Z");
    repositories.notificationSettings.now = () => now;

    expect(await sendTest()).toMatchObject({ status: 202, body: { queued: true } });
    now += 59_000;
    expect(await sendTest()).toMatchObject({ status: 200, body: { queued: false, message: TEST_ALREADY_SENT } });
    expect(repositories.notificationSettings.tests).toHaveLength(1);

    now += 1_000;
    expect(await sendTest()).toMatchObject({ status: 202, body: { queued: true } });
  });

  it("limits each user separately", async () => {
    await sendTest();
    signIn(otherUser);
    expect(await sendTest()).toMatchObject({ status: 202 });
  });

  it("answers 500 with a generic message when the test can't be queued", async () => {
    vi.spyOn(repositories.notificationSettings, "sendTest").mockRejectedValue(new Error("private failure"));
    expect(await sendTest()).toMatchObject({ status: 500, body: { error: "Unable to send a test notification. Please try again." } });
  });
});

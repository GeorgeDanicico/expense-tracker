import webpush, { WebPushError } from "web-push";
import { describe, expect, it, vi } from "vitest";

import { PUSH_TTL_SECONDS, classifyPushStatus, createWebPushSender, readVapidConfig } from "@/lib/notifications/push";

// A throwaway pair made for this test run; never a real key.
const keys = webpush.generateVAPIDKeys();
const vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:push@example.test" };
const target = { endpoint: "https://push.example.test/abc", p256dh: "p256dh-key", auth: "auth-secret" };
const payload = { title: "Pay rent", body: "Due today at 09:00", url: "/reminders?focus=r1", tag: "reminder:r1" };

function webPushError(status: number, body = "") {
  return new WebPushError("Received unexpected response code", status, {}, body, target.endpoint);
}

describe("readVapidConfig", () => {
  it("reads the three variables, trimmed", () => {
    expect(readVapidConfig({ VAPID_PUBLIC_KEY: ` ${vapid.publicKey} `, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: vapid.subject }))
      .toEqual({ ok: true, config: vapid });
  });

  it("names the missing or empty ones, never a value", () => {
    const result = readVapidConfig({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: "  " });
    expect(result).toEqual({ ok: false, missing: ["VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] });
    expect(JSON.stringify(result)).not.toContain(vapid.publicKey);
  });
});

describe("classifyPushStatus", () => {
  it.each([
    [404, "gone"],
    [410, "gone"],
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [400, "rejected"],
    [403, "rejected"],
    [413, "rejected"],
  ])("treats %i as %s", (status, outcome) => {
    expect(classifyPushStatus(status, "x").outcome).toBe(outcome);
  });
});

describe("createWebPushSender", () => {
  it("refuses a malformed key at creation", () => {
    expect(() => createWebPushSender({ ...vapid, publicKey: "short" })).toThrow();
  });

  it("sends the four payload fields with the VAPID keys, a 24-hour TTL and high urgency", async () => {
    const send = vi.fn().mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    expect(await createWebPushSender(vapid, send).send(target, { ...payload, extra: "dropped" } as typeof payload)).toEqual({ outcome: "sent" });

    expect(send).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      expect.objectContaining({ vapidDetails: vapid, TTL: PUSH_TTL_SECONDS, urgency: "high" }),
    );
    expect(PUSH_TTL_SECONDS).toBe(86_400);
  });

  it.each([
    [webPushError(410), { outcome: "gone", status: 410 }],
    [webPushError(404), { outcome: "gone", status: 404 }],
    [webPushError(429, "slow down"), { outcome: "retry", status: 429, error: "Push service answered 429: slow down" }],
    [webPushError(502), { outcome: "retry", status: 502, error: "Push service answered 502" }],
    [webPushError(400), { outcome: "rejected", status: 400, error: "Push service answered 400" }],
    [Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), { outcome: "retry", status: null, error: "connect ECONNREFUSED" }],
    [new Error("Socket timeout"), { outcome: "retry", status: null, error: "Socket timeout" }],
    [new Error("The subscription p256dh value should be 65 bytes long."), { outcome: "rejected", status: null, error: "The subscription p256dh value should be 65 bytes long." }],
  ])("turns %s into a result instead of throwing", async (error, expected) => {
    const send = vi.fn().mockRejectedValue(error);
    expect(await createWebPushSender(vapid, send).send(target, payload)).toEqual(expected);
  });

  it("never puts the endpoint in an error", async () => {
    const send = vi.fn().mockRejectedValue(webPushError(500, "oops"));
    const result = await createWebPushSender(vapid, send).send(target, payload);
    expect(JSON.stringify(result)).not.toContain(target.endpoint);
  });
});

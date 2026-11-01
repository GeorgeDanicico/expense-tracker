import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_CHANGE_MAX_ATTEMPTS, EMAIL_CHANGE_WINDOW_MS, resetRateLimits } from "@/lib/http/rate-limit";
import { FakeAuth } from "@/test/fakes/auth";
import { callRoute, signedInAs } from "@/test/route";

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthenticatedUser: vi.fn() }));

import { PATCH } from "@/app/api/account/email/route";

beforeEach(() => {
  resetRateLimits();
  auth = new FakeAuth();
  auth.currentUser = signedInAs(auth.addUser("ana@kids.ifam.invalid", "kid-password"));
});

function changeEmail(body: unknown) {
  return callRoute(PATCH, { method: "PATCH", url: "/api/account/email", body });
}

describe("PATCH /api/account/email", () => {
  it("asks the provider to change the email and confirm it back on the settings page", async () => {
    const response = await changeEmail({ email: "ana@example.com" });

    expect(response.status).toBe(204);
    expect(auth.lastEmailChange?.email).toBe("ana@example.com");
    const url = new URL(auth.lastEmailChange?.confirmationUrl ?? "");
    expect(url.pathname).toBe("/auth/confirm");
    expect(url.searchParams.get("next")).toBe("/settings");
  });

  it("trims the address", async () => {
    await changeEmail({ email: "  ana@example.com " });

    expect(auth.lastEmailChange?.email).toBe("ana@example.com");
  });

  it.each([{ email: "not-an-email" }, { email: "" }, {}, { email: 5 }, { email: "x@kids.ifam.invalid" }])(
    "rejects %j without asking the provider",
    async (body) => {
      const response = await changeEmail(body);

      expect(response).toMatchObject({ status: 422, body: { error: "Enter a valid email address." } });
      expect(auth.lastEmailChange).toBeNull();
    },
  );

  it("rejects a malformed body", async () => {
    expect((await changeEmail("{")).status).toBe(422);
  });

  it("passes the provider's reason on when it refuses the address", async () => {
    auth.addUser("taken@example.com", "other-password");

    const response = await changeEmail({ email: "taken@example.com" });

    expect(response).toMatchObject({
      status: 400,
      body: { error: "A user with this email address has already been registered" },
    });
  });

  it("hides an unexpected failure behind a generic message", async () => {
    vi.spyOn(auth, "updateEmail").mockRejectedValue(new Error("private failure"));

    const response = await changeEmail({ email: "ana@example.com" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to change your email. Please try again." } });
  });

  it("answers the 6th attempt in an hour with 429 and Retry-After, counting refused ones, without asking the provider", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T09:00:00.000Z"));
    try {
      auth.addUser("taken@example.com", "other-password");
      for (let attempt = 0; attempt < EMAIL_CHANGE_MAX_ATTEMPTS; attempt += 1) {
        expect((await changeEmail({ email: "taken@example.com" })).status).toBe(400);
      }
      const update = vi.spyOn(auth, "updateEmail");

      const limited = await changeEmail({ email: "ana@example.com" });

      expect(limited).toMatchObject({
        status: 429,
        body: { error: "You've tried to change your email a lot recently. Try again in an hour." },
      });
      expect(limited.headers.get("retry-after")).toBe(String(EMAIL_CHANGE_WINDOW_MS / 1000));
      expect(update).not.toHaveBeenCalled();

      vi.setSystemTime(new Date(Date.now() + EMAIL_CHANGE_WINDOW_MS));
      expect((await changeEmail({ email: "ana@example.com" })).status).toBe(204);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts attempts per user", async () => {
    for (let attempt = 0; attempt < EMAIL_CHANGE_MAX_ATTEMPTS; attempt += 1) await changeEmail({ email: "ana@example.com" });
    expect((await changeEmail({ email: "ana@example.com" })).status).toBe(429);

    auth.currentUser = signedInAs(auth.addUser("bob@example.com", "bob-password"));

    expect((await changeEmail({ email: "bob@example.org" })).status).toBe(204);
  });
});

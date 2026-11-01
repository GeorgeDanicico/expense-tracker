import { beforeEach, describe, expect, it, vi } from "vitest";

import { PASSWORD_CHANGE_MAX_ATTEMPTS, PASSWORD_CHANGE_WINDOW_MS, resetRateLimits } from "@/lib/http/rate-limit";
import { FakeAuth } from "@/test/fakes/auth";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/account/password/route";

const OLD_PASSWORD = "first-password";
const NEW_PASSWORD = "brand-new-password";

let repositories: FakeRepositories;
let user: ReturnType<typeof signedInAs>;

beforeEach(() => {
  resetRateLimits();
  auth = new FakeAuth();
  repositories = resetFakeRepositories();
  user = signedInAs(auth.addUser("kid@kids.ifam.invalid", OLD_PASSWORD));
  auth.currentUser = user;
  repositories.account.caller.userId = user.id;
  repositories.account.mustChangePassword.add(user.id);
});

function changePassword(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/account/password", body });
}

function storedPassword() {
  return auth.accounts.find((account) => account.id === user.id)?.password;
}

describe("POST /api/account/password", () => {
  it("updates the password and clears the must-change-password flag", async () => {
    const response = await changePassword({ password: NEW_PASSWORD });

    expect(response.status).toBe(204);
    expect(storedPassword()).toBe(NEW_PASSWORD);
    expect(repositories.account.mustChangePassword.has(user.id)).toBe(false);
  });

  it("lets a user without the flag change their password too", async () => {
    repositories.account.mustChangePassword.clear();

    const response = await changePassword({ password: NEW_PASSWORD });

    expect(response.status).toBe(204);
    expect(storedPassword()).toBe(NEW_PASSWORD);
  });

  it("answers privately, so the response is never cached", async () => {
    const { headers } = await changePassword({ password: NEW_PASSWORD });

    expect(headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("rejects a password shorter than 8 characters without changing anything", async () => {
    const response = await changePassword({ password: "short" });

    expect(response).toMatchObject({
      status: 422,
      body: {
        error: "Check the highlighted details and try again.",
        fieldErrors: { password: ["Password must contain at least 8 characters."] },
      },
    });
    expect(storedPassword()).toBe(OLD_PASSWORD);
    expect(repositories.account.mustChangePassword.has(user.id)).toBe(true);
  });

  it("rejects a password longer than 128 characters", async () => {
    const response = await changePassword({ password: "a".repeat(129) });

    expect(response).toMatchObject({
      status: 422,
      body: { fieldErrors: { password: ["Password must contain at most 128 characters."] } },
    });
  });

  it("rejects a malformed body", async () => {
    const response = await changePassword("{");

    expect(response).toMatchObject({ status: 422, body: { error: "Check the highlighted details and try again." } });
    expect(storedPassword()).toBe(OLD_PASSWORD);
  });

  it("rejects a body without a password", async () => {
    const response = await changePassword({});

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { password: ["Enter a password."] } } });
  });

  it("keeps the flag and passes the reason on when the auth provider refuses the password", async () => {
    auth.fail("updatePassword", "New password should be different from the old password.");

    const response = await changePassword({ password: NEW_PASSWORD });

    expect(response).toMatchObject({
      status: 400,
      body: { error: "New password should be different from the old password." },
    });
    expect(repositories.account.mustChangePassword.has(user.id)).toBe(true);
  });

  it("answers 429 when the auth provider rate-limits the change", async () => {
    auth.fail("updatePassword", "Too many attempts.", "rate_limited");

    const response = await changePassword({ password: NEW_PASSWORD });

    expect(response).toMatchObject({ status: 429, body: { error: "Too many attempts." } });
    expect(repositories.account.mustChangePassword.has(user.id)).toBe(true);
  });

  it("does not clear the flag when the password update fails", async () => {
    const complete = vi.spyOn(repositories.account, "completePasswordChange");
    auth.fail("updatePassword");

    await changePassword({ password: NEW_PASSWORD });

    expect(complete).not.toHaveBeenCalled();
  });

  it("hides a failure to clear the flag behind a generic message", async () => {
    vi.spyOn(repositories.account, "completePasswordChange").mockRejectedValue(new Error("private database failure"));

    const response = await changePassword({ password: NEW_PASSWORD });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to change your password. Please try again." } });
  });

  it("answers the 11th attempt in an hour with 429 and Retry-After, counting refused ones, without asking the provider", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T09:00:00.000Z"));
    try {
      for (let attempt = 0; attempt < PASSWORD_CHANGE_MAX_ATTEMPTS; attempt += 1) {
        auth.fail("updatePassword", "New password should be different from the old password.");
        expect((await changePassword({ password: NEW_PASSWORD })).status).toBe(400);
      }
      const update = vi.spyOn(auth, "updatePassword");

      const limited = await changePassword({ password: NEW_PASSWORD });

      expect(limited).toMatchObject({
        status: 429,
        body: { error: "You've tried to change your password a lot recently. Try again in an hour." },
      });
      expect(limited.headers.get("retry-after")).toBe(String(PASSWORD_CHANGE_WINDOW_MS / 1000));
      expect(update).not.toHaveBeenCalled();
      expect(storedPassword()).toBe(OLD_PASSWORD);

      vi.setSystemTime(new Date(Date.now() + PASSWORD_CHANGE_WINDOW_MS));
      expect((await changePassword({ password: NEW_PASSWORD })).status).toBe(204);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts attempts per user", async () => {
    for (let attempt = 0; attempt < PASSWORD_CHANGE_MAX_ATTEMPTS; attempt += 1) await changePassword({ password: NEW_PASSWORD });
    expect((await changePassword({ password: NEW_PASSWORD })).status).toBe(429);

    const other = signedInAs(auth.addUser("other@example.test", OLD_PASSWORD));
    auth.currentUser = other;
    repositories.account.caller.userId = other.id;

    expect((await changePassword({ password: NEW_PASSWORD })).status).toBe(204);
  });
});

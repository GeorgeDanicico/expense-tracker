import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAuth } from "@/test/fakes/auth";
import { callRoute, signedInAs } from "@/test/route";

let auth: FakeAuth;
vi.mock("@/lib/auth", () => ({ getAuth: () => auth, getAuthenticatedUser: vi.fn() }));

import { PATCH } from "@/app/api/account/email/route";

beforeEach(() => {
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
});

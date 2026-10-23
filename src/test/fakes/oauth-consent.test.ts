import { beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import { FakeAuth } from "@/test/fakes/auth";
import { FakeOAuthConsent } from "@/test/fakes/oauth-consent";

describe("FakeOAuthConsent", () => {
  let auth: FakeAuth;
  let consent: FakeOAuthConsent;
  let user: { id: string; email: string };

  beforeEach(() => {
    auth = new FakeAuth();
    consent = new FakeOAuthConsent(auth);
    user = auth.addUser("a@example.test", "a long password");
    auth.currentUser = user;
  });

  it("shows the caller's request, approves it once and lists the app", async () => {
    const id = consent.addRequest(user.id);

    expect(await consent.getRequest(id)).toMatchObject({ kind: "needs_consent", authorizationId: id, scopes: ["email"] });
    expect((await consent.approve(id)).redirectUrl).toMatch(/^http:\/\/localhost:4567\/callback\?code=/);
    expect(await consent.getRequest(id)).toBeNull();
    expect(await consent.listConnectedApps()).toMatchObject([{ clientId: "client-1", scopes: ["email"] }]);
  });

  it("denies with access_denied", async () => {
    const id = consent.addRequest(user.id);

    expect(await consent.deny(id)).toEqual({ redirectUrl: "http://localhost:4567/callback?error=access_denied" });
    expect(await consent.listConnectedApps()).toEqual([]);
  });

  it("answers already_approved for an auto-approved request", async () => {
    const id = consent.addRequest(user.id, { alreadyApproved: true });

    expect(await consent.getRequest(id)).toMatchObject({ kind: "already_approved" });
  });

  it("hides another user's request and refuses to answer it", async () => {
    const other = auth.addUser("b@example.test", "a long password");
    const id = consent.addRequest(other.id);
    const notFound = new DomainError("That authorization request doesn't exist or has expired.", 404);

    expect(await consent.getRequest(id)).toBeNull();
    await expect(consent.approve(id)).rejects.toEqual(notFound);
    await expect(consent.deny(id)).rejects.toEqual(notFound);
  });

  it("disconnects only the caller's app and ends its tokens", async () => {
    const other = auth.addUser("b@example.test", "a long password");
    consent.addGrant(user.id);
    consent.addGrant(other.id);
    const token = auth.issueAppToken(user, "client-1");

    await consent.disconnect("client-1");

    expect(await consent.listConnectedApps()).toEqual([]);
    expect(consent.grants.map((grant) => grant.userId)).toEqual([other.id]);
    expect(await auth.verifyAppToken(token)).toBeNull();
  });

  it("fails the next call of a method on request", async () => {
    consent.fail("listConnectedApps", new Error("down"));

    await expect(consent.listConnectedApps()).rejects.toThrow("down");
    await expect(consent.listConnectedApps()).resolves.toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import { FakeAuth, FakeAuthAdmin } from "@/test/fakes/auth";

const kid = {
  email: "mia@kids.ifam.invalid",
  password: "a long password",
  username: "mia",
  displayName: "Mia",
  managedByFamily: "family-1",
  mustChangePassword: true,
};

describe("FakeAuthAdmin", () => {
  let auth: FakeAuth;
  let admin: FakeAuthAdmin;

  beforeEach(() => {
    auth = new FakeAuth();
    admin = new FakeAuthAdmin(auth);
  });

  it("creates a confirmed account that can sign in, with its profile", async () => {
    const user = await admin.createUser(kid);

    expect(admin.profiles.get(user.id)).toEqual({
      username: "mia",
      displayName: "Mia",
      managedByFamily: "family-1",
      mustChangePassword: true,
    });
    expect(await auth.signInWithPassword(kid.email, kid.password)).toEqual({ ok: true });
  });

  it("refuses a taken username or email", async () => {
    await admin.createUser(kid);

    await expect(admin.createUser({ ...kid, email: "other@kids.ifam.invalid" })).rejects.toEqual(
      new DomainError("That username is taken.", 409),
    );
    await expect(admin.createUser({ ...kid, username: "leo" })).rejects.toEqual(
      new DomainError("An account with that email already exists.", 409),
    );
  });

  it("finds the email by username, ignoring case", async () => {
    await admin.createUser(kid);

    expect(await admin.findEmailByUsername("MIA")).toBe(kid.email);
    expect(await admin.findEmailByUsername("leo")).toBeNull();
  });

  it("sets a password that sign-in then checks", async () => {
    const user = await admin.createUser(kid);

    await admin.setPassword(user.id, "a new password");

    expect(await auth.signInWithPassword(kid.email, "a new password")).toEqual({ ok: true });
  });

  it("deletes the account and its profile", async () => {
    const user = await admin.createUser(kid);

    await admin.deleteUser(user.id);

    expect(admin.deletedUserIds).toEqual([user.id]);
    expect(admin.profiles.size).toBe(0);
    expect(await admin.findEmailByUsername("mia")).toBeNull();
    await expect(admin.setPassword(user.id, "a new password")).rejects.toEqual(
      new DomainError("That account doesn't exist.", 404),
    );
  });

  it("throws the given error on the next call only", async () => {
    admin.fail("createUser", new Error("down"));

    await expect(admin.createUser(kid)).rejects.toThrow("down");
    await expect(admin.createUser(kid)).resolves.toMatchObject({ email: kid.email });
  });
});

describe("FakeAuth app tokens", () => {
  let auth: FakeAuth;

  beforeEach(() => {
    auth = new FakeAuth();
  });

  it("verifies a live app token, and refuses it once the app is disconnected", async () => {
    const user = auth.addUser("a@example.test", "a long password");
    const token = auth.issueAppToken(user, "client-1");
    const other = auth.issueAppToken(user, "client-2");

    expect(await auth.verifyAppToken(token)).toEqual({ userId: user.id, email: user.email, clientId: "client-1" });
    auth.revokeAppTokens(user.id, "client-1");
    expect(await auth.verifyAppToken(token)).toBeNull();
    expect(await auth.verifyAppToken(other)).not.toBeNull();
    expect(await auth.verifyAppToken("unknown")).toBeNull();
  });

  it("acts as the token's user only inside the session's run", async () => {
    const user = auth.addUser("a@example.test", "a long password");
    const session = auth.sessionForAppToken(auth.issueAppToken(user, "client-1"));

    expect(await session.run(() => auth.getCurrentUser())).toEqual(user);
    expect(await auth.getCurrentUser()).toBeNull();
    expect(await session.isActive()).toBe(true);
    auth.revokeAppTokens(user.id, "client-1");
    expect(await session.isActive()).toBe(false);
  });
});

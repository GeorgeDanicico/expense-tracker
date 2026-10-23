import { beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import { generateMcpToken } from "@/lib/mcp/tokens";
import { FakeMcpTokenRepository } from "@/test/fakes/mcp-tokens";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const start = new Date("2026-10-23T10:00:00.000Z");

/** A fresh secret for create or regenerate. */
function secret() {
  const { hash, prefix } = generateMcpToken();
  return { hash, prefix };
}

describe("FakeMcpTokenRepository", () => {
  let repository: FakeMcpTokenRepository;
  let now: Date;

  beforeEach(() => {
    repository = new FakeMcpTokenRepository();
    now = new Date(start);
    repository.now = () => new Date(now);
    repository.users.set(owner, { email: "owner@example.test", enabled: true, kid: null });
  });

  function advance(ms: number) {
    now = new Date(now.getTime() + ms);
  }

  async function createAs(userId: string, name = "VPS", expiry: "1m" | "3m" | "6m" | "never" = "3m") {
    const caller = repository.caller;
    repository.caller = { userId };
    const created = secret();
    const token = await repository.create({ name, ...created, expiry });
    repository.caller = caller;
    return { token, ...created };
  }

  describe("access and the switch", () => {
    it("is mcp_off with the switch off and ok once an adult turns it on", async () => {
      repository.users.set(owner, { email: "owner@example.test", enabled: false, kid: null });

      expect(await repository.access()).toEqual({ status: "mcp_off", personalTokens: true });
      await repository.setEnabled(true);
      expect(await repository.access()).toEqual({ status: "ok", personalTokens: true });
    });

    it("treats an unseeded account as an adult with the switch off", async () => {
      repository.caller = { userId: other };

      expect(await repository.access()).toEqual({ status: "mcp_off", personalTokens: true });
    });

    it("refuses a kid without the permission, then one without a real email, and lets a kid with both turn it on", async () => {
      const kid = { email: "mia@kids.ifam.invalid", enabled: false, kid: { mcp: false } };
      repository.users.set(owner, kid);

      await expect(repository.setEnabled(true)).rejects.toEqual(new DomainError("A parent needs to turn on AI assistants for you.", 403));
      kid.kid.mcp = true;
      await expect(repository.setEnabled(true)).rejects.toEqual(
        new DomainError("Add and confirm an email address in Settings to use AI assistants.", 403),
      );
      kid.email = "mia@example.test";
      await repository.setEnabled(true);
      expect(await repository.access()).toEqual({ status: "ok", personalTokens: false });
    });

    it("reports a kid's block reason only once the switch is on, like access_status", async () => {
      repository.users.set(owner, { email: "mia@kids.ifam.invalid", enabled: false, kid: { mcp: true } });
      expect(await repository.access()).toEqual({ status: "mcp_off", personalTokens: false });

      repository.users.set(owner, { email: "mia@kids.ifam.invalid", enabled: true, kid: { mcp: true } });
      expect(await repository.access()).toEqual({ status: "email_required", personalTokens: false });

      repository.users.set(owner, { email: "mia@example.test", enabled: true, kid: { mcp: false } });
      expect(await repository.access()).toEqual({ status: "not_permitted", personalTokens: false });
    });

    it("always lets anyone turn the switch off", async () => {
      repository.users.set(owner, { email: "mia@kids.ifam.invalid", enabled: true, kid: { mcp: false } });

      await repository.setEnabled(false);
      expect(repository.users.get(owner)?.enabled).toBe(false);
    });
  });

  describe("create", () => {
    it.each([
      ["1m", "2026-11-23T10:00:00.000Z"],
      ["3m", "2027-01-23T10:00:00.000Z"],
      ["6m", "2027-04-23T10:00:00.000Z"],
      ["never", null],
    ] as const)("sets the expiry for %s", async (expiry, expiresAt) => {
      const { token } = await createAs(owner, "VPS", expiry);

      expect(token).toEqual({
        id: expect.any(String),
        name: "VPS",
        prefix: expect.stringMatching(/^sl_mcp_/),
        createdAt: start.toISOString(),
        regeneratedAt: null,
        lastUsedAt: null,
        expiresAt,
      });
    });

    it("refuses any other expiry", async () => {
      await expect(repository.create({ name: "VPS", ...secret(), expiry: "1y" as never })).rejects.toEqual(
        new DomainError("Choose an expiry: 1 month, 3 months, 6 months or never.", 422),
      );
    });

    it("refuses kids", async () => {
      repository.users.set(owner, { email: "mia@example.test", enabled: true, kid: { mcp: true } });

      await expect(repository.create({ name: "VPS", ...secret(), expiry: "3m" })).rejects.toEqual(
        new DomainError("Kids connect AI assistants through the app's sign-in page, not with tokens.", 403),
      );
    });

    it("refuses an 11th live token, not counting revoked or expired ones", async () => {
      const { token: revoked } = await createAs(owner);
      await repository.revoke(revoked.id);
      await createAs(owner, "Short", "1m");
      advance(40 * 24 * 60 * 60_000);
      for (let index = 0; index < 10; index += 1) await createAs(owner, `Token ${index}`);

      await expect(repository.create({ name: "One more", ...secret(), expiry: "3m" })).rejects.toEqual(
        new DomainError("You can have at most 10 personal tokens. Revoke one to create another.", 409),
      );
      await expect(createAs(other)).resolves.toBeDefined();
    });

    it.each(["", " padded", "x".repeat(41)])("refuses the name %j", async (name) => {
      await expect(repository.create({ name, ...secret(), expiry: "3m" })).rejects.toEqual(
        new DomainError("Give the token a name of 1 to 40 characters.", 422),
      );
    });

    it("refuses a hash or prefix that isn't from generateMcpToken", async () => {
      await expect(repository.create({ name: "VPS", hash: "nope", prefix: "sl_mcp_Ab3xQ9", expiry: "3m" })).rejects.toEqual(
        new DomainError("That token isn't valid.", 422),
      );
    });
  });

  describe("list", () => {
    it("shows the caller's unrevoked tokens, expired ones included, newest first", async () => {
      const { token: first } = await createAs(owner, "First", "1m");
      advance(60_000);
      const { token: revoked } = await createAs(owner, "Revoked");
      advance(60_000);
      const { token: last } = await createAs(owner, "Last");
      await createAs(other, "Someone else's");
      await repository.revoke(revoked.id);
      advance(60 * 24 * 60 * 60_000);

      expect((await repository.list()).map((token) => token.id)).toEqual([last.id, first.id]);
    });
  });

  describe("regenerate", () => {
    it("swaps in the new secret, resets the expiry and last use, and the old secret stops working", async () => {
      const { token, hash: oldHash } = await createAs(owner, "VPS", "1m");
      await repository.check(oldHash);
      advance(60 * 24 * 60 * 60_000);
      const fresh = secret();

      const regenerated = await repository.regenerate(token.id, { ...fresh, expiry: "never" });

      expect(regenerated).toEqual({
        ...token,
        prefix: fresh.prefix,
        regeneratedAt: now.toISOString(),
        lastUsedAt: null,
        expiresAt: null,
      });
      expect(await repository.check(oldHash)).toEqual({ status: "unknown" });
      expect(await repository.check(fresh.hash)).toMatchObject({ status: "ok", tokenId: token.id });
    });

    it.each(["another user's", "a revoked", "an unknown"])("is a 404 for %s token", async (kind) => {
      const { token } = await createAs(kind === "another user's" ? other : owner);
      if (kind === "a revoked") await repository.revoke(token.id);
      const id = kind === "an unknown" ? "a0000000-0000-4000-8000-000000000999" : token.id;

      await expect(repository.regenerate(id, { ...secret(), expiry: "3m" })).rejects.toEqual(new DomainError("Token not found.", 404));
    });

    it("refuses kids", async () => {
      const { token } = await createAs(owner);
      repository.users.set(owner, { email: "mia@example.test", enabled: true, kid: { mcp: true } });

      await expect(repository.regenerate(token.id, { ...secret(), expiry: "3m" })).rejects.toMatchObject({ status: 403 });
    });

    it("refuses making an expired token live again at the cap", async () => {
      const { token: expired } = await createAs(owner, "Short", "1m");
      advance(40 * 24 * 60 * 60_000);
      for (let index = 0; index < 10; index += 1) await createAs(owner, `Token ${index}`);

      await expect(repository.regenerate(expired.id, { ...secret(), expiry: "3m" })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("revoke", () => {
    it("revokes the caller's token once, and expired ones too", async () => {
      const { token } = await createAs(owner, "VPS", "1m");
      advance(40 * 24 * 60 * 60_000);

      expect(await repository.revoke(token.id)).toBe(true);
      expect(await repository.revoke(token.id)).toBe(false);
    });

    it("is false for another user's token and changes nothing", async () => {
      const { token, hash } = await createAs(other);
      repository.users.set(other, { email: "other@example.test", enabled: true, kid: null });

      expect(await repository.revoke(token.id)).toBe(false);
      expect(await repository.check(hash)).toMatchObject({ status: "ok" });
    });
  });

  describe("check", () => {
    it("returns the owner of a live token and records the use at most every 5 minutes", async () => {
      const { token, hash } = await createAs(owner);

      expect(await repository.check(hash)).toEqual({ status: "ok", tokenId: token.id, user: { id: owner, email: "owner@example.test" } });
      const firstUse = repository.tokens[0].lastUsedAt;
      expect(firstUse).toBe(start.toISOString());
      advance(60_000);
      await repository.check(hash);
      expect(repository.tokens[0].lastUsedAt).toBe(firstUse);
      advance(5 * 60_000);
      await repository.check(hash);
      expect(repository.tokens[0].lastUsedAt).toBe(now.toISOString());
    });

    it("answers in the database's order: unknown, revoked, expired, kid_token, then access", async () => {
      expect(await repository.check("f".repeat(64))).toEqual({ status: "unknown" });

      const { token: revoked, hash: revokedHash } = await createAs(owner, "Revoked", "1m");
      await repository.revoke(revoked.id);
      const { hash: expiredHash } = await createAs(owner, "Expired", "1m");
      const { hash } = await createAs(owner, "Live", "never");
      advance(40 * 24 * 60 * 60_000);
      // A kid with the switch off: expired and revoked still win, then kid_token over mcp_off.
      repository.users.set(owner, { email: "mia@kids.ifam.invalid", enabled: false, kid: { mcp: false } });

      expect(await repository.check(revokedHash)).toEqual({ status: "revoked" });
      expect(await repository.check(expiredHash)).toEqual({ status: "expired" });
      expect(await repository.check(hash)).toEqual({ status: "kid_token" });

      repository.users.set(owner, { email: "owner@example.test", enabled: false, kid: null });
      expect(await repository.check(hash)).toEqual({ status: "mcp_off" });
      expect(repository.tokens.every((token) => token.lastUsedAt === null)).toBe(true);
    });
  });
});

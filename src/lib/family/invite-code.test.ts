import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import {
  INVITE_CODE_ATTEMPTS,
  generateInviteCode,
  hashInviteCode,
  withFreshInviteCode,
} from "@/lib/family/invite-code";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, inviteCodeSchema } from "@/lib/validation/family";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("generateInviteCode", () => {
  it("makes 8-character codes from the invite alphabet only", () => {
    for (let index = 0; index < 500; index += 1) {
      const code = generateInviteCode();

      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect([...code].every((character) => INVITE_CODE_ALPHABET.includes(character))).toBe(true);
    }
  });

  it("never uses the look-alike characters 0, O, 1, I or L", () => {
    const characters = new Set(Array.from({ length: 500 }, generateInviteCode).join(""));

    for (const lookAlike of "0O1IL") expect(characters.has(lookAlike)).toBe(false);
  });

  it("makes a different code each time", () => {
    const codes = new Set(Array.from({ length: 200 }, generateInviteCode));

    expect(codes.size).toBe(200);
  });

  it("makes codes the join form accepts as they are", () => {
    const code = generateInviteCode();

    expect(inviteCodeSchema.parse(code)).toBe(code);
  });
});

describe("hashInviteCode", () => {
  it("hashes a code as lowercase hex sha256", () => {
    expect(hashInviteCode("ABCD2345")).toBe(sha256("ABCD2345"));
    expect(hashInviteCode("ABCD2345")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes before hashing, so a typed code matches the generated one", () => {
    const hash = hashInviteCode("ABCD2345");

    expect(hashInviteCode("abcd2345")).toBe(hash);
    expect(hashInviteCode("ABCD-2345")).toBe(hash);
    expect(hashInviteCode(" abcd 2345 ")).toBe(hash);
  });

  it("gives different codes different hashes", () => {
    expect(hashInviteCode("ABCD2345")).not.toBe(hashInviteCode("ABCD2346"));
  });
});

describe("withFreshInviteCode", () => {
  it("passes the code's hash to create and returns the plain code with the result", async () => {
    const create = vi.fn(async (codeHash: string) => ({ codeHash }));

    const { code, result } = await withFreshInviteCode(create);

    expect(create).toHaveBeenCalledOnce();
    expect(result.codeHash).toBe(hashInviteCode(code));
  });

  it("tries a new code when the hash is already in use", async () => {
    const create = vi
      .fn<(codeHash: string) => Promise<string>>()
      .mockRejectedValueOnce(new DomainError("That invite code is already in use.", 409))
      .mockImplementation(async (codeHash) => codeHash);

    const { code, result } = await withFreshInviteCode(create);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).not.toBe(create.mock.calls[1][0]);
    expect(result).toBe(hashInviteCode(code));
  });

  it("gives up with a plain error after a few clashes, so the user never sees a 409", async () => {
    const create = vi.fn().mockRejectedValue(new DomainError("That invite code is already in use.", 409));

    const failure = withFreshInviteCode(create);

    await expect(failure).rejects.toThrow(Error);
    await expect(failure).rejects.not.toBeInstanceOf(DomainError);
    expect(create).toHaveBeenCalledTimes(INVITE_CODE_ATTEMPTS);
  });

  it("passes any other failure on without retrying", async () => {
    const forbidden = new DomainError("Only parents can invite people to the family.", 403);
    const create = vi.fn().mockRejectedValue(forbidden);

    await expect(withFreshInviteCode(create)).rejects.toBe(forbidden);
    expect(create).toHaveBeenCalledOnce();
  });
});

import "server-only";

import { createHash, randomInt } from "node:crypto";

import { DomainError } from "@/lib/errors";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode } from "@/lib/validation/family";

/** How many fresh codes `withFreshInviteCode` tries before giving up. */
export const INVITE_CODE_ATTEMPTS = 3;

/**
 * A new random invite code: `INVITE_CODE_LENGTH` characters from `INVITE_CODE_ALPHABET`, each picked
 * with `crypto.randomInt`. Treat it as a secret: show it once and never log it.
 */
export function generateInviteCode(): string {
  let code = "";
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The only form of a code that reaches the database: sha256 of the normalized code (uppercased, spaces
 * and dashes removed) as 64 lowercase hex characters. A typed code and the generated one hash alike.
 */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(normalizeInviteCode(code), "utf8").digest("hex");
}

/**
 * Runs `create` with a fresh code's hash, and with another fresh code when the hash is already in use
 * (a 409 `DomainError`), up to `INVITE_CODE_ATTEMPTS` times. Returns `create`'s result with the plain
 * code. A clash is the server's problem, not the user's, so running out of attempts throws a plain
 * `Error`, which routes answer with a generic 500.
 */
export async function withFreshInviteCode<T>(
  create: (codeHash: string) => Promise<T>,
): Promise<{ code: string; result: T }> {
  for (let attempt = 1; attempt <= INVITE_CODE_ATTEMPTS; attempt += 1) {
    const code = generateInviteCode();
    try {
      return { code, result: await create(hashInviteCode(code)) };
    } catch (error) {
      if (!(error instanceof DomainError && error.status === 409)) throw error;
    }
  }
  throw new Error(`No unused invite code after ${INVITE_CODE_ATTEMPTS} attempts.`);
}

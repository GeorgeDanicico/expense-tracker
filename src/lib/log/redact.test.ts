import { describe, expect, it } from "vitest";

import { createLogger } from "@/lib/log";
import { MAX_DEPTH, MAX_ITEMS, MAX_STRING_LENGTH, REDACTED, redactString, sanitizeFields, sanitizeValue } from "@/lib/log/redact";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const UUID = "20000000-0000-4000-8000-000000000002";

/** What one line looks like once written. */
function written(fields: Parameters<ReturnType<typeof createLogger>["info"]>[1]) {
  const out: string[] = [];
  createLogger({ out: (line) => out.push(line), level: "debug" }).info("x", fields);
  const { time, level, event, ...rest } = JSON.parse(out[0]);
  void time;
  void level;
  void event;
  return rest as Record<string, unknown>;
}

describe("redaction by field name", () => {
  it.each([
    "password",
    "passcode",
    "secret",
    "token",
    "accessToken",
    "refreshToken",
    "apiKey",
    "authorization",
    "cookie",
    "setCookie",
    "email",
    "code",
    "body",
    "payload",
    "prompt",
    "answer",
    "rows",
  ])("redacts %s", (name) => {
    expect(written({ [name]: "Hunter 2!" })).toEqual({ [name]: REDACTED });
  });

  it("ignores case, underscores and hyphens in the name", () => {
    expect(
      written({ PASSWORD: "a", Access_Token: "b", "set-cookie": "c", API_KEY: "d", "Refresh-Token": "e", Set_Cookie: "f" }),
    ).toEqual({ PASSWORD: REDACTED, Access_Token: REDACTED, "set-cookie": REDACTED, API_KEY: REDACTED, "Refresh-Token": REDACTED, Set_Cookie: REDACTED });
  });

  it("redacts whatever the value is: objects, arrays, numbers, booleans and null", () => {
    expect(written({ body: { a: 1 }, rows: [1, 2], token: 5, cookie: true, email: null })).toEqual({
      body: REDACTED,
      rows: REDACTED,
      token: REDACTED,
      cookie: REDACTED,
      email: REDACTED,
    });
  });

  it("redacts a name that contains password, passcode, secret, cookie, authorization or apikey", () => {
    for (const name of [
      "newPassword",
      "currentPassword",
      "passwordConfirm",
      "kid_passcode",
      "clientSecret",
      "client_secret",
      "sessionCookie",
      "authorizationHeader",
      "x-api-key",
      "openaiApiKey",
    ]) {
      expect(written({ [name]: "Hunter 2!" }), name).toEqual({ [name]: REDACTED });
    }
  });

  it("redacts a name that ends with token, but not tokens or other names that merely contain it", () => {
    for (const name of ["token", "accessToken", "refresh_token", "idToken", "mcpToken", "csrf-token", "ID_TOKEN"]) {
      expect(written({ [name]: "Hunter 2!" }), name).toEqual({ [name]: REDACTED });
    }
    expect(written({ inputTokens: 12, outputTokens: 34, tokenId: "abc", tokenCount: 3, tokens: 5 })).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      tokenId: "abc",
      tokenCount: 3,
      tokens: 5,
    });
  });

  it("matches email, emails, code, body, payload, prompt, answer and rows exactly, not as part of a name", () => {
    expect(written({ emails: ["Hunter 2!"] })).toEqual({ emails: REDACTED });
    expect(written({ bodyLength: 10, emailed: true, emailVerified: true, rowCount: 7, requestId: "abc", promptTokens: 4 })).toEqual({
      bodyLength: 10,
      emailed: true,
      emailVerified: true,
      rowCount: 7,
      requestId: "abc",
      promptTokens: 4,
    });
  });

  it("treats errorCode as an ordinary field: the code rule doesn't apply, the value patterns do", () => {
    expect(written({ errorCode: "AB23CD45" })).toEqual({ errorCode: "AB23CD45" });
    expect(written({ errorCode: "unrecognised_layout" })).toEqual({ errorCode: "unrecognised_layout" });
    expect(written({ errorCode: "a@b.co" })).toEqual({ errorCode: REDACTED });
  });

  it("redacts by name at any depth, in objects inside arrays", () => {
    expect(written({ a: { b: [{ password: "x", keep: "y" }] } })).toEqual({ a: { b: [{ password: REDACTED, keep: "y" }] } });
  });

  it("keeps a code that is an error code and redacts any other", () => {
    expect(written({ code: "unrecognised_layout" })).toEqual({ code: "unrecognised_layout" });
    expect(written({ code: "23505" })).toEqual({ code: "23505" });
    expect(written({ code: 23505 })).toEqual({ code: 23505 });
    expect(written({ code: "PGRST116" })).toEqual({ code: "PGRST116" });
    expect(written({ code: "ECONNRESET" })).toEqual({ code: "ECONNRESET" });
    // An invite code (8 characters of its alphabet) and anything with spaces, symbols or too long.
    expect(written({ code: "AB23CD45" })).toEqual({ code: REDACTED });
    expect(written({ code: "ab 23" })).toEqual({ code: REDACTED });
    expect(written({ code: "a".repeat(41) })).toEqual({ code: REDACTED });
    expect(written({ code: "" })).toEqual({ code: REDACTED });
    expect(written({ code: 1.5 })).toEqual({ code: REDACTED });
    expect(written({ code: { a: 1 } })).toEqual({ code: REDACTED });
    expect(written({ code: true })).toEqual({ code: REDACTED });
  });

  it("still applies the value patterns to a kept code", () => {
    expect(written({ code: "a@b" })).toEqual({ code: REDACTED });
  });
});

describe("redaction by value pattern", () => {
  it("redacts Supabase keys and keeps the rest of the string", () => {
    expect(redactString("key sb_secret_AbC123-_xyz used")).toBe(`key ${REDACTED} used`);
    expect(redactString("key sb_publishable_AbC123 used")).toBe(`key ${REDACTED} used`);
  });

  it("redacts Bearer credentials in any case", () => {
    expect(redactString("Authorization failed: Bearer abc.DEF-123_xyz== rejected")).toBe(`Authorization failed: ${REDACTED} rejected`);
    expect(redactString("bearer abc123")).toBe(REDACTED);
  });

  it("redacts anything shaped like a JWT", () => {
    expect(redactString(`token ${JWT} expired`)).toBe(`token ${REDACTED} expired`);
    expect(redactString("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.")).toBe(REDACTED);
    // A JWT cut short, or one of its parts on its own.
    expect(redactString(`release ${JWT.slice(0, 40)}`)).toBe(`release ${REDACTED}.${REDACTED}`);
    expect(redactString(`part ${JWT.split(".")[1]} end`)).toBe(`part ${REDACTED} end`);
    // Too short to be one, and not at a word's start.
    expect(redactString("eyJhbGciOi and keyJhbGciOiJIUzI1")).toBe("eyJhbGciOi and keyJhbGciOiJIUzI1");
  });

  it("redacts email addresses", () => {
    expect(redactString("user george.d+tag@example.co.uk not found")).toBe(`user ${REDACTED} not found`);
    expect(redactString("a@b.co and c@d.io")).toBe(`${REDACTED} and ${REDACTED}`);
  });

  it("redacts runs of 32 or more base64url characters", () => {
    expect(redactString(`calendar token ${"Ab3_-".repeat(7)} done`)).toBe(`calendar token ${REDACTED} done`);
    expect(redactString("x".repeat(32))).toBe(REDACTED);
    expect(redactString("x".repeat(31))).toBe("x".repeat(31));
  });

  it("keeps ids: UUIDs, 12-character request ids and commit hashes", () => {
    expect(redactString(`user ${UUID} not found`)).toBe(`user ${UUID} not found`);
    expect(redactString("request 3fK9xQ2mBv0a failed")).toBe("request 3fK9xQ2mBv0a failed");
    const sha = "bb246557d3b7ac45e8cbd0d6e0b0f3e6a4f2c1de";
    expect(redactString(sha)).toBe(sha);
  });

  it("applies in any field, nested, in arrays and in keys", () => {
    expect(
      written({ note: "a@b.co", list: [JWT, { deep: "Bearer xyz" }], "c@d.io": 1 }),
    ).toEqual({ note: REDACTED, list: [REDACTED, { deep: REDACTED }], [REDACTED]: 1 });
  });
});

describe("clipping and limits", () => {
  it("clips strings to 500 characters with a trailing ellipsis", () => {
    const clipped = redactString("a ".repeat(400));
    expect(clipped).toHaveLength(MAX_STRING_LENGTH);
    expect(clipped.endsWith("…")).toBe(true);
    expect(redactString("a ".repeat(250))).toHaveLength(MAX_STRING_LENGTH);
    expect(redactString("a".repeat(31).repeat(1))).toHaveLength(31);
  });

  it("copes with a very long string", () => {
    expect(redactString("word ".repeat(1_000_000))).toHaveLength(MAX_STRING_LENGTH);
  });

  it("redacts a secret that would straddle the clip", () => {
    const text = `${"a ".repeat(240)}${"k".repeat(40)}`;
    const clipped = redactString(text);
    expect(clipped).not.toContain("kkkkk");
  });

  it("truncates nesting deeper than 4 levels below the fields", () => {
    let nested: unknown = "leaf";
    for (let level = 0; level < 8; level += 1) nested = { next: nested };
    const result = sanitizeFields({ root: nested as never });
    let node = result.root as Record<string, unknown>;
    for (let level = 1; level < MAX_DEPTH; level += 1) node = node.next as Record<string, unknown>;
    expect(node.next).toBe("[truncated]");
  });

  it("keeps the first 50 array items and marks the rest", () => {
    const items = sanitizeValue(Array.from({ length: 60 }, (_, index) => index)) as unknown[];
    expect(items).toHaveLength(MAX_ITEMS + 1);
    expect(items[49]).toBe(49);
    expect(items[50]).toBe("[truncated]");
    expect(sanitizeValue(Array.from({ length: 50 }, (_, index) => index))).toHaveLength(50);
  });

  it("keeps the first 50 keys of an object and says how many were dropped", () => {
    const big = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`k${index}`, index]));
    const result = sanitizeValue(big) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(MAX_ITEMS + 1);
    expect(result.k49).toBe(49);
    expect(result.k50).toBeUndefined();
    expect(result._truncated).toBe(10);
    const exact = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`k${index}`, index]));
    expect(sanitizeValue(exact)).not.toHaveProperty("_truncated");
  });

  it("applies the key limit to the fields of a line too", () => {
    const fields = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`f${index}`, index]));
    expect(Object.keys(sanitizeFields(fields))).toHaveLength(MAX_ITEMS + 1);
  });
});

describe("values JSON can't hold", () => {
  it("writes a cycle, a BigInt, a function and a symbol as [unserializable]", () => {
    const cycle: Record<string, unknown> = { name: "loop" };
    cycle.self = cycle;
    const array: unknown[] = [];
    array.push(array);
    expect(
      sanitizeFields({ cycle: cycle as never, array: array as never, big: 1n as never, fn: (() => 1) as never, sym: Symbol("s") as never }),
    ).toEqual({
      cycle: { name: "loop", self: "[unserializable]" },
      array: ["[unserializable]"],
      big: "[unserializable]",
      fn: "[unserializable]",
      sym: "[unserializable]",
    });
  });

  it("allows the same object twice when it isn't a cycle", () => {
    const shared = { a: 1 };
    expect(sanitizeFields({ x: shared, y: shared })).toEqual({ x: { a: 1 }, y: { a: 1 } });
  });

  it("writes a throwing getter as [unserializable]", () => {
    const trap = {
      get boom(): string {
        throw new Error("no");
      },
      fine: 1,
    };
    expect(sanitizeFields(trap)).toEqual({ boom: "[unserializable]", fine: 1 });
  });

  it("writes non-finite numbers as null, dates as ISO strings and undefined array items as null", () => {
    expect(sanitizeFields({ nan: Number.NaN, inf: Infinity, date: new Date("2026-10-25T09:00:00.000Z") as never, bad: new Date("nope") as never, list: [undefined as never] })).toEqual({
      nan: null,
      inf: null,
      date: "2026-10-25T09:00:00.000Z",
      bad: null,
      list: [null],
    });
  });

  it("writes an Error value as its name and redacted message only", () => {
    const error = new TypeError("bad input a@b.co");
    expect(sanitizeFields({ error: error as never })).toEqual({ error: { name: "TypeError", message: `bad input ${REDACTED}` } });
  });

  it("doesn't let a __proto__ key change the prototype", () => {
    const fields = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const result = sanitizeFields(fields);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.ok).toBe(1);
  });
});

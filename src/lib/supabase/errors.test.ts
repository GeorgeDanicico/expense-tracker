import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import { isUserFacing, translateDatabaseError, USER_FACING_HINT } from "@/lib/supabase/errors";

const FALLBACK = "Unable to save.";

describe("translateDatabaseError", () => {
  it.each([
    ["42501", 403],
    ["P0002", 404],
    ["23514", 422],
    ["22023", 422],
    ["23505", 409],
    ["55000", 409],
  ])("passes our own marked message for code %s through as a %i", (code, status) => {
    const translated = translateDatabaseError({ code, message: "Only parents can do this.", hint: USER_FACING_HINT }, FALLBACK);

    expect(translated).toBeInstanceOf(DomainError);
    expect(translated).toMatchObject({ status, message: "Only parents can do this." });
  });

  it("answers a row-level security violation with a 403 and the fallback, never the policy text", () => {
    const translated = translateDatabaseError({
      code: "42501",
      message: 'new row violates row-level security policy for table "reminders"',
      hint: null,
    }, FALLBACK);

    expect(translated).toBeInstanceOf(DomainError);
    expect(translated).toMatchObject({ status: 403, message: FALLBACK });
  });

  it("answers a check constraint failure with a 422 and the fallback, never the constraint text", () => {
    const translated = translateDatabaseError({
      code: "23514",
      message: 'new row for relation "todos" violates check constraint "todos_title_check"',
    }, FALLBACK);

    expect(translated).toMatchObject({ status: 422, message: FALLBACK });
    expect(translated.message).not.toMatch(/todos|constraint/);
  });

  it("answers Postgres' own unique violation with a 409 and the fallback", () => {
    const translated = translateDatabaseError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "net_worth_valuations_item_id_valued_on_key"',
    }, FALLBACK);

    expect(translated).toMatchObject({ status: 409, message: FALLBACK });
  });

  it("ignores any hint other than the marker", () => {
    const translated = translateDatabaseError({ code: "42501", message: "permission denied for table x", hint: "Grant it." }, FALLBACK);

    expect(translated).toMatchObject({ status: 403, message: FALLBACK });
  });

  it("uses a call's own message for a code, whoever raised it", () => {
    const messages = { "23505": "A valuation for this date already exists." };

    expect(translateDatabaseError({ code: "23505", message: "duplicate key" }, FALLBACK, { messages }))
      .toMatchObject({ status: 409, message: "A valuation for this date already exists." });
    expect(translateDatabaseError({ code: "23505", message: "Ours.", hint: USER_FACING_HINT }, FALLBACK, { messages }))
      .toMatchObject({ status: 409, message: "A valuation for this date already exists." });
  });

  it("uses a call's own status for a code the shared map doesn't know", () => {
    const capped = { code: "P0001", message: "You can have at most 10 personal tokens.", hint: USER_FACING_HINT };

    expect(translateDatabaseError(capped, FALLBACK, { statuses: { P0001: 409 } }))
      .toMatchObject({ status: 409, message: "You can have at most 10 personal tokens." });
    expect(translateDatabaseError(capped, FALLBACK)).not.toBeInstanceOf(DomainError);
  });

  it("turns any other code into a plain error with the fallback message, even when marked", () => {
    const translated = translateDatabaseError({ code: "08006", message: "connection failure", hint: USER_FACING_HINT }, FALLBACK);

    expect(translated).not.toBeInstanceOf(DomainError);
    expect(translated.message).toBe(FALLBACK);
  });

  it("turns an error without a code into a plain error with the fallback message", () => {
    const translated = translateDatabaseError({ message: "private database failure" }, FALLBACK);

    expect(translated).not.toBeInstanceOf(DomainError);
    expect(translated.message).toBe(FALLBACK);
  });
});

describe("isUserFacing", () => {
  it("is true only for the marker hint", () => {
    expect(isUserFacing({ message: "x", hint: "user" })).toBe(true);
    expect(isUserFacing({ message: "x", hint: "User" })).toBe(false);
    expect(isUserFacing({ message: "x", hint: null })).toBe(false);
    expect(isUserFacing({ message: "x" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import { translateDatabaseError } from "@/lib/supabase/errors";

describe("translateDatabaseError", () => {
  it.each([
    ["42501", 403],
    ["P0002", 404],
    ["23514", 422],
    ["23505", 409],
  ])("turns Postgres code %s into a %i domain error with the database's message", (code, status) => {
    const translated = translateDatabaseError({ code, message: "Only parents can do this." }, "Unable to save.");

    expect(translated).toBeInstanceOf(DomainError);
    expect(translated).toMatchObject({ status, message: "Only parents can do this." });
  });

  it("turns any other code into a plain error with the fallback message", () => {
    const translated = translateDatabaseError({ code: "08006", message: "connection failure" }, "Unable to save.");

    expect(translated).not.toBeInstanceOf(DomainError);
    expect(translated.message).toBe("Unable to save.");
  });

  it("turns an error without a code into a plain error with the fallback message", () => {
    const translated = translateDatabaseError({ message: "private database failure" }, "Unable to save.");

    expect(translated).not.toBeInstanceOf(DomainError);
    expect(translated.message).toBe("Unable to save.");
  });
});

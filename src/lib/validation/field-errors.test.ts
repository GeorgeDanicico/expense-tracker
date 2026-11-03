import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fieldErrorsOf } from "@/lib/validation/field-errors";

const schema = z.object({
  name: z.string().min(1, "Enter a name."),
  amount: z.number().positive("Enter an amount above zero.").max(10, "Too much."),
  nested: z.object({ day: z.string() }),
});

function errorsFor(input: unknown) {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error("expected the input to be refused");
  return fieldErrorsOf(parsed.error);
}

describe("fieldErrorsOf", () => {
  it("lists the messages of each failing top-level field", () => {
    expect(errorsFor({ name: "", amount: -1, nested: { day: "x" } })).toEqual({
      name: ["Enter a name."],
      amount: ["Enter an amount above zero."],
    });
  });

  it("collects several messages for one field, and leaves out fields that passed", () => {
    expect(errorsFor({ name: "ok", amount: 11, nested: { day: "x" } })).toEqual({ amount: ["Too much."] });
  });

  it("files a nested error under its top-level field", () => {
    expect(Object.keys(errorsFor({ name: "ok", amount: 1, nested: {} }))).toEqual(["nested"]);
  });
});

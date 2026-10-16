import { describe, expect, it } from "vitest";

import { passwordSchema } from "@/lib/validation/password";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("passwordSchema", () => {
  it.each([8, 128])("accepts a password of %i characters", (length) => {
    expect(passwordSchema.safeParse("a".repeat(length)).success).toBe(true);
  });

  it("keeps spaces, so the password is used exactly as typed", () => {
    expect(passwordSchema.parse(" correct horse ")).toBe(" correct horse ");
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(messages(passwordSchema.safeParse("a".repeat(7)))).toEqual(["Password must contain at least 8 characters."]);
  });

  it("rejects a password longer than 128 characters", () => {
    expect(messages(passwordSchema.safeParse("a".repeat(129)))).toEqual(["Password must contain at most 128 characters."]);
  });

  it("rejects a missing password", () => {
    expect(messages(passwordSchema.safeParse(undefined))).toEqual(["Enter a password."]);
  });
});

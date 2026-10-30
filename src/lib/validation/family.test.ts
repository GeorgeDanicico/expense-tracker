import { describe, expect, it } from "vitest";

import { PERMISSION_PRESETS } from "@/lib/permissions";
import {
  createInviteSchema,
  displayNameSchema,
  familyNameSchema,
  inviteCodeSchema,
  joinFamilySchema,
  normalizeInviteCode,
  permissionsSchema,
  usernameSchema,
} from "@/lib/validation/family";

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("permissionsSchema", () => {
  it.each(Object.entries(PERMISSION_PRESETS))("accepts the %s preset", (_, permissions) => {
    expect(permissionsSchema.parse(permissions)).toEqual(permissions);
  });

  it("accepts family finance at view", () => {
    const permissions = { expenses: "off", investments: "off", net_worth: "off", family_finance: "view", mcp: "off", ai: "off" };

    expect(permissionsSchema.parse(permissions)).toEqual(permissions);
  });

  it("rejects a missing module", () => {
    expect(permissionsSchema.safeParse({ expenses: "edit", investments: "off", net_worth: "off" }).success).toBe(false);
  });

  it("rejects an unknown module", () => {
    const result = permissionsSchema.safeParse({ ...PERMISSION_PRESETS.teen, savings: "edit" });

    expect(messages(result)).toEqual(["Permissions may only list known modules."]);
  });

  it.each([
    { module: "expenses", level: "view" },
    { module: "investments", level: "view" },
    { module: "net_worth", level: "view" },
    { module: "family_finance", level: "edit" },
    { module: "expenses", level: "admin" },
    { module: "expenses", level: null },
  ])("rejects $level for $module", ({ module, level }) => {
    const result = permissionsSchema.safeParse({ ...PERMISSION_PRESETS.young_kid, [module]: level });

    expect(result.success).toBe(false);
  });

  it("names the module in the error", () => {
    const result = permissionsSchema.safeParse({ ...PERMISSION_PRESETS.young_kid, net_worth: "view" });

    expect(messages(result)).toEqual(["Choose an allowed level for Net worth."]);
  });

  it.each([null, [], "edit"])("rejects %j instead of an object", (input) => {
    expect(permissionsSchema.safeParse(input).success).toBe(false);
  });
});

describe("familyNameSchema", () => {
  it("trims the name and accepts 1 to 60 characters", () => {
    expect(familyNameSchema.parse("  The Smiths  ")).toBe("The Smiths");
    expect(familyNameSchema.parse("x".repeat(60))).toBe("x".repeat(60));
  });

  it.each([
    { input: "   ", message: "Enter a family name." },
    { input: "x".repeat(61), message: "Use at most 60 characters." },
  ])("rejects $input", ({ input, message }) => {
    expect(messages(familyNameSchema.safeParse(input))).toEqual([message]);
  });
});

describe("usernameSchema", () => {
  it.each([
    ["ana", "ana"],
    ["  Ana.Pop  ", "ana.pop"],
    ["9lives", "9lives"],
    ["a_b-c.d", "a_b-c.d"],
    ["x".repeat(30), "x".repeat(30)],
  ])("accepts %j as %j", (input, expected) => {
    expect(usernameSchema.parse(input)).toBe(expected);
  });

  it.each(["ab", "x".repeat(31), ".ana", "_ana", "-ana", "ana pop", "ana@pop", "anä", ""])("rejects %j", (input) => {
    expect(usernameSchema.safeParse(input).success).toBe(false);
  });
});

describe("displayNameSchema", () => {
  it("trims the name and accepts 1 to 40 characters", () => {
    expect(displayNameSchema.parse("  Ana  ")).toBe("Ana");
    expect(displayNameSchema.parse("x".repeat(40))).toBe("x".repeat(40));
  });

  it.each([
    { input: " ", message: "Enter a name." },
    { input: "x".repeat(41), message: "Use at most 40 characters." },
  ])("rejects $input", ({ input, message }) => {
    expect(messages(displayNameSchema.safeParse(input))).toEqual([message]);
  });
});

describe("inviteCodeSchema", () => {
  it.each([
    ["ABCD2345", "ABCD2345"],
    ["abcd2345", "ABCD2345"],
    ["abcd-2345", "ABCD2345"],
    [" AB CD-23 45 ", "ABCD2345"],
    ["HJKMNPQR", "HJKMNPQR"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(inviteCodeSchema.parse(input)).toBe(expected);
    expect(normalizeInviteCode(input)).toBe(expected);
  });

  it.each(["ABCD234", "ABCD23456", "ABCD2340", "ABCD234O", "ABCD2341", "ABCD234I", "ABCD234L", "ABCD234!", ""])(
    "rejects %j",
    (input) => {
      expect(messages(inviteCodeSchema.safeParse(input))).toEqual(["Enter the 8-character invite code."]);
    },
  );

  it("rejects a non-string", () => {
    expect(inviteCodeSchema.safeParse(12345678).success).toBe(false);
  });
});

describe("createInviteSchema", () => {
  it("accepts a parent invite without permissions", () => {
    expect(createInviteSchema.parse({ role: "parent" })).toEqual({ role: "parent", permissions: null });
    expect(createInviteSchema.parse({ role: "parent", permissions: null })).toEqual({ role: "parent", permissions: null });
  });

  it("accepts a kid invite with every module's level", () => {
    expect(createInviteSchema.parse({ role: "kid", permissions: PERMISSION_PRESETS.teen })).toEqual({
      role: "kid",
      permissions: PERMISSION_PRESETS.teen,
    });
  });

  it("requires permissions for a kid invite", () => {
    expect(createInviteSchema.safeParse({ role: "kid" }).error?.flatten().fieldErrors).toEqual({
      permissions: ["Choose what the kid can use."],
    });
  });

  it("refuses permissions on a parent invite", () => {
    expect(
      createInviteSchema.safeParse({ role: "parent", permissions: PERMISSION_PRESETS.teen }).error?.flatten().fieldErrors,
    ).toEqual({ permissions: ["Parents always have full access."] });
  });

  it("refuses an unknown role", () => {
    expect(messages(createInviteSchema.safeParse({ role: "grandparent" }))).toEqual([
      "Choose whether to invite a parent or a kid.",
    ]);
  });

  it("refuses a level the module doesn't allow", () => {
    const permissions = { ...PERMISSION_PRESETS.young_kid, family_finance: "edit" };

    expect(createInviteSchema.safeParse({ role: "kid", permissions }).success).toBe(false);
  });
});

describe("joinFamilySchema", () => {
  it("normalizes the code", () => {
    expect(joinFamilySchema.parse({ code: " abcd-2345 " })).toEqual({ code: "ABCD2345" });
  });

  it.each([{}, { code: null }, { code: 12345678 }, { code: "ABCD234" }])("rejects %j with the code's message", (body) => {
    const result = joinFamilySchema.safeParse(body);

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toEqual({ code: ["Enter the 8-character invite code."] });
  });
});

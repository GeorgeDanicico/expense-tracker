import { describe, expect, it } from "vitest";

import {
  can,
  DEFAULT_KID_PERMISSIONS,
  isLevelAllowed,
  MODULE_KEYS,
  MODULE_LABELS,
  MODULE_LEVEL_LABELS,
  MODULE_LEVELS,
  normalizePermissions,
  PERMISSION_LEVELS,
  PERMISSION_PRESETS,
  type PermissionLevel,
} from "@/lib/permissions";

// Characterization test: SQL migrations hard-code this catalogue. Update the
// snapshot only together with a migration that changes the same values.
describe("permission catalogue", () => {
  it("lists the same modules, levels, labels and defaults", () => {
    const table = MODULE_KEYS.map((module) => ({
      module,
      label: MODULE_LABELS[module],
      levels: MODULE_LEVELS[module],
      levelLabels: MODULE_LEVEL_LABELS[module],
      defaultForNewKid: DEFAULT_KID_PERMISSIONS[module],
    }));

    expect({ levels: PERMISSION_LEVELS, modules: table, presets: PERMISSION_PRESETS }).toMatchSnapshot();
  });

  it("only allows the levels each module lists", () => {
    expect(isLevelAllowed("expenses", "edit")).toBe(true);
    expect(isLevelAllowed("expenses", "view")).toBe(false);
    expect(isLevelAllowed("family_finance", "view")).toBe(true);
    expect(isLevelAllowed("family_finance", "edit")).toBe(false);
  });
});

describe("presets", () => {
  it("gives a young kid the defaults", () => {
    expect(PERMISSION_PRESETS.young_kid).toEqual({
      expenses: "edit", investments: "off", net_worth: "off", family_finance: "off", mcp: "off",
    });
  });

  it("gives a teen every finance module but not family finance", () => {
    expect(PERMISSION_PRESETS.teen).toEqual({
      expenses: "edit", investments: "edit", net_worth: "edit", family_finance: "off", mcp: "off",
    });
  });
});

describe("can", () => {
  const combinations = MODULE_KEYS.flatMap((module) =>
    PERMISSION_LEVELS.flatMap((held) => PERMISSION_LEVELS.map((required) => ({ module, held, required }))),
  );

  it.each(combinations)(
    "a kid at $held on $module passes a $required check only when $held is at least $required",
    ({ module, held, required }) => {
      const expected = PERMISSION_LEVELS.indexOf(held) >= PERMISSION_LEVELS.indexOf(required);

      expect(can({ role: "kid", permissions: { [module]: held } }, module, required)).toBe(expected);
    },
  );

  it.each(MODULE_KEYS)("treats a missing %s permission as off", (module) => {
    const kid = { role: "kid" as const, permissions: {} };

    expect(can(kid, module, "off")).toBe(true);
    expect(can(kid, module, "view")).toBe(false);
    expect(can(kid, module, "edit")).toBe(false);
  });

  it("lets a view check pass at edit", () => {
    expect(can({ role: "kid", permissions: { expenses: "edit" } }, "expenses", "view")).toBe(true);
  });

  it.each(MODULE_KEYS.flatMap((module) => PERMISSION_LEVELS.map((level) => ({ module, level }))))(
    "always lets a parent use $module at $level",
    ({ module, level }) => {
      expect(can({ role: "parent", permissions: {} }, module, level)).toBe(true);
    },
  );

  it.each(MODULE_KEYS.flatMap((module) => PERMISSION_LEVELS.map((level) => ({ module, level }))))(
    "always lets a user without a family use $module at $level",
    ({ module, level }) => {
      expect(can(null, module, level)).toBe(true);
    },
  );
});

describe("normalizePermissions", () => {
  it("fills missing modules with off and keeps the given ones", () => {
    expect(normalizePermissions({ investments: "edit", family_finance: "view" })).toEqual({
      expenses: "off", investments: "edit", net_worth: "off", family_finance: "view", mcp: "off",
    });
  });

  it("turns no permissions into every module off", () => {
    const off = Object.fromEntries(MODULE_KEYS.map((module) => [module, "off" satisfies PermissionLevel]));

    expect(normalizePermissions({})).toEqual(off);
  });
});

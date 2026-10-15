/**
 * The family permission catalogue. These values are mirrored in SQL (the
 * `member_permissions` check and the invite and RPC validation), so change
 * them only together with a migration.
 */

export const FAMILY_ROLES = ["parent", "kid"] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

export const MODULE_KEYS = ["expenses", "investments", "net_worth", "family_finance"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Every level, lowest first: `off < view < edit`. */
export const PERMISSION_LEVELS = ["off", "view", "edit"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const LEVEL_ORDER: Record<PermissionLevel, number> = { off: 0, view: 1, edit: 2 };

/** The levels each module allows, lowest first. */
export const MODULE_LEVELS = {
  expenses: ["off", "edit"],
  investments: ["off", "edit"],
  net_worth: ["off", "edit"],
  family_finance: ["off", "view"],
} as const satisfies Record<ModuleKey, readonly PermissionLevel[]>;

export type ModuleLevel<M extends ModuleKey> = (typeof MODULE_LEVELS)[M][number];

/** A level for every module. Stored kid permissions may omit modules; see `normalizePermissions`. */
export type Permissions = { [M in ModuleKey]: ModuleLevel<M> };

export const MODULE_LABELS: Record<ModuleKey, string> = {
  expenses: "Expenses",
  investments: "Investments",
  net_worth: "Net worth",
  family_finance: "Family finance",
};

/** How each allowed level is shown in the UI. */
export const MODULE_LEVEL_LABELS: { [M in ModuleKey]: Record<ModuleLevel<M>, string> } = {
  expenses: { off: "Off", edit: "On" },
  investments: { off: "Off", edit: "On" },
  net_worth: { off: "Off", edit: "On" },
  family_finance: { off: "Off", view: "Can see" },
};

export const DEFAULT_KID_PERMISSIONS: Permissions = {
  expenses: "edit",
  investments: "off",
  net_worth: "off",
  family_finance: "off",
};

export const PERMISSION_PRESET_KEYS = ["young_kid", "teen"] as const;
export type PermissionPreset = (typeof PERMISSION_PRESET_KEYS)[number];

export const PERMISSION_PRESETS: Record<PermissionPreset, Permissions> = {
  young_kid: DEFAULT_KID_PERMISSIONS,
  teen: { expenses: "edit", investments: "edit", net_worth: "edit", family_finance: "off" },
};

/** A member as permission checks see them; `permissions` may omit modules (missing rows). */
export type PermissionSubject = { role: FamilyRole; permissions: Partial<Record<ModuleKey, PermissionLevel>> };

export function isLevelAllowed(module: ModuleKey, level: PermissionLevel) {
  return (MODULE_LEVELS[module] as readonly PermissionLevel[]).includes(level);
}

/**
 * Whether `member` may use `module` at `level` or above. `null` means the user
 * has no family, which always passes, as do parents. A missing module is `off`.
 */
export function can(member: PermissionSubject | null, module: ModuleKey, level: PermissionLevel) {
  if (!member || member.role === "parent") return true;
  return LEVEL_ORDER[member.permissions[module] ?? "off"] >= LEVEL_ORDER[level];
}

/** Fills every missing module with `off`. */
export function normalizePermissions(partial: Partial<Permissions>): Permissions {
  return {
    expenses: partial.expenses ?? "off",
    investments: partial.investments ?? "off",
    net_worth: partial.net_worth ?? "off",
    family_finance: partial.family_finance ?? "off",
  };
}

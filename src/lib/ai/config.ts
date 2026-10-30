import "server-only";

/** Millionths of a dollar: the unit of the ledger, so a call that costs a fraction of a cent is exact. */
export const MICROS_PER_USD = 1_000_000;

/** What a family may spend on AI in a month when `AI_FAMILY_MONTHLY_USD` isn't set. */
export const DEFAULT_FAMILY_MONTHLY_USD = 3;
/** What everyone may spend in a month when `AI_MONTHLY_BUDGET_USD` isn't set: about three families' worth. */
export const DEFAULT_GLOBAL_MONTHLY_USD = 10;

export type AiLimits = {
  /** The most one family (or one user without a family) may spend in a month. */
  familyMonthlyMicros: number;
  /** The global backstop: when everyone's month reaches it, the kill switch turns off. */
  globalMonthlyMicros: number;
};

export function usdToMicros(usd: number) {
  return Math.round(usd * MICROS_PER_USD);
}

/** A dollar amount from the environment: a number of zero or more, else `fallback`. */
function readUsd(value: string | undefined, fallback: number) {
  const text = value?.trim();
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** The budgets, from `AI_FAMILY_MONTHLY_USD` (default 3) and `AI_MONTHLY_BUDGET_USD` (default 10). */
export function getAiLimits(env: Record<string, string | undefined> = process.env): AiLimits {
  return {
    familyMonthlyMicros: usdToMicros(readUsd(env.AI_FAMILY_MONTHLY_USD, DEFAULT_FAMILY_MONTHLY_USD)),
    globalMonthlyMicros: usdToMicros(readUsd(env.AI_MONTHLY_BUDGET_USD, DEFAULT_GLOBAL_MONTHLY_USD)),
  };
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The admins' user ids, from `APP_ADMIN_USER_IDS`: a comma-separated list. Anything that isn't a
 * user id is ignored; the list may be empty. They are told when the global budget turns AI off.
 */
export function getAdminUserIds(env: Record<string, string | undefined> = process.env): string[] {
  const ids = (env.APP_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => USER_ID.test(id));
  return [...new Set(ids)];
}

import "server-only";

import { DEFAULT_FAMILY_MONTHLY_USD, DEFAULT_GLOBAL_MONTHLY_USD, parseServerEnv } from "@/lib/env";

export { DEFAULT_FAMILY_MONTHLY_USD, DEFAULT_GLOBAL_MONTHLY_USD };

/** Millionths of a dollar: the unit of the ledger, so a call that costs a fraction of a cent is exact. */
export const MICROS_PER_USD = 1_000_000;

export type AiLimits = {
  /** The most one family (or one user without a family) may spend in a month. */
  familyMonthlyMicros: number;
  /** The global backstop: when everyone's month reaches it, the kill switch turns off. */
  globalMonthlyMicros: number;
};

export function usdToMicros(usd: number) {
  return Math.round(usd * MICROS_PER_USD);
}

/** The budgets, from `AI_FAMILY_MONTHLY_USD` (default 3) and `AI_MONTHLY_BUDGET_USD` (default 10), as `src/lib/env.ts` reads them. */
export function getAiLimits(env?: Record<string, string | undefined>): AiLimits {
  const parsed = parseServerEnv(env);
  return {
    familyMonthlyMicros: usdToMicros(parsed.AI_FAMILY_MONTHLY_USD),
    globalMonthlyMicros: usdToMicros(parsed.AI_MONTHLY_BUDGET_USD),
  };
}

/**
 * The admins' user ids, from `APP_ADMIN_USER_IDS`: a comma-separated list. Anything that isn't a
 * user id is ignored; the list may be empty. They are told when the global budget turns AI off.
 */
export function getAdminUserIds(env?: Record<string, string | undefined>): string[] {
  return parseServerEnv(env).APP_ADMIN_USER_IDS;
}

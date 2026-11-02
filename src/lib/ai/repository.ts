import type { NewNotification } from "@/lib/notifications/worker-store";

/**
 * Storage for the AI gate (docs/statement-import-plan.md, I14): the kill switch, the opt-in, the
 * reservations and the usage ledger, and the budget notifications. The Supabase implementation is
 * `src/lib/supabase/repositories/ai.ts`; `src/test/fakes/ai.ts` is the in-memory one.
 */

/** The caller's access to AI features (`my_ai_access`): the opt-in switch and, for a kid, the `ai` permission. */
export type AiAccess = "ok" | "ai_off" | "not_permitted";

/** Why a model call ended: `ok`, or how it failed. The same words as the provider interface's failure reasons. */
export const AI_OUTCOMES = ["ok", "max_tokens", "refusal", "invalid_output", "timeout", "rate_limited", "provider_error"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/**
 * A call to reserve before it is made (`ai_reserve_budget`): its worst case, and the month and limits
 * to check it against. The family is worked out by the repository.
 */
export type AiReservationRequest = {
  userId: string;
  /** A short lowercase key for what the call is for, such as `statements`. */
  feature: string;
  provider: string;
  model: string;
  /** Millionths of a dollar: the most the call could cost. */
  estimatedMicros: number;
  monthStart: Date;
  familyLimitMicros: number;
  globalLimitMicros: number;
};

/**
 * What the reservation found: `ok` with the new ledger row, or why the call may not be made. The
 * spends are the month's before this call, given once they were read.
 */
export type AiReservation =
  | { status: "ok"; reservationId: string; familySpentMicros: number; globalSpentMicros: number }
  | { status: "flag_off" | "ai_off" | "not_permitted" }
  | { status: "family_budget"; familySpentMicros: number }
  | { status: "global_budget"; familySpentMicros: number; globalSpentMicros: number };

/** A finished call's real numbers, replacing its reservation's worst case (`ai_settle_usage`). */
export type AiSettlement = {
  reservationId: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  /** Part of `inputTokens` the provider billed at its cached price; 0 when it doesn't report it. */
  cachedInputTokens: number;
  /** Millionths of a dollar. */
  costMicros: number;
  outcome: AiOutcome;
  /** The month whose spend comes back. */
  monthStart: Date;
};

/** A month's spend, in micros: the family's (the user's own without one) and everyone's. */
export type AiMonthSpend = { familySpentMicros: number; globalSpentMicros: number };

/** Who hears about a family's budget: the parents of the user's family, or the user alone. */
export type BudgetRecipients = {
  /** The user's family now, or null when they have none. */
  familyId: string | null;
  userIds: string[];
};

export interface AiGateRepository {
  /** The kill switch, `app_flags.ai_enabled`. A missing flag counts as off. */
  isEnabled(): Promise<boolean>;
  /** Whether the user has opted in, and for a kid has the `ai` permission. */
  access(userId: string): Promise<AiAccess>;
  /**
   * Turns the user's opt-in switch (`profiles.ai_enabled`) on or off, as the signed-in caller (the
   * Settings → AI switch). Turning it off always works; a `DomainError` 403 with the database's
   * message for a kid without the `ai` permission who turns it on.
   */
  setOptIn(userId: string, enabled: boolean): Promise<void>;
  /**
   * Checks the kill switch, the user's opt-in and both months in one step, and when the call fits,
   * writes its worst case to the ledger as a reservation. Atomic: two reservations at once are
   * checked one after the other, so they can't both take the last of a budget. The family's month
   * is that of the user's family now (their own without one), every member's calls counted.
   */
  reserve(request: AiReservationRequest): Promise<AiReservation>;
  /**
   * Replaces a reservation's worst case with the call's real numbers and returns the month's spend
   * after it. Throws when the reservation isn't the user's or was already settled.
   */
  settle(settlement: AiSettlement): Promise<AiMonthSpend>;
  /** Turns the kill switch on or off, recording no user. */
  setEnabled(enabled: boolean): Promise<void>;
  budgetRecipients(userId: string): Promise<BudgetRecipients>;
  /** Queues a notification; a `dedupeKey` that is already queued is `duplicate` and changes nothing. */
  enqueueNotification(notification: NewNotification): Promise<"queued" | "duplicate">;
}

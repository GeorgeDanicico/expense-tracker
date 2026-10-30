import type { NewNotification } from "@/lib/notifications/worker-store";

/**
 * Storage for the AI gate (docs/statement-import-plan.md, I14): the kill switch, the opt-in, the
 * month's spend, the usage ledger and the budget notifications. The Supabase implementation is
 * `src/lib/supabase/repositories/ai.ts`; `src/test/fakes/ai.ts` is the in-memory one.
 */

/** The caller's access to AI features (`my_ai_access`): the opt-in switch and, for a kid, the `ai` permission. */
export type AiAccess = "ok" | "ai_off" | "not_permitted";

/** Why a model call ended: `ok`, or how it failed. The same words as the provider interface's failure reasons. */
export const AI_OUTCOMES = ["ok", "max_tokens", "refusal", "invalid_output", "timeout", "rate_limited", "provider_error"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/** One ledger row (`ai_usage`), as the gate writes it. The family is worked out by the repository. */
export type AiUsageRecord = {
  userId: string;
  /** A short lowercase key for what the call was for, such as `statements`. */
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Part of `inputTokens` the provider billed at its cached price; 0 when it doesn't report it. */
  cachedInputTokens: number;
  /** Millionths of a dollar. */
  costMicros: number;
  outcome: AiOutcome;
};

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
   * The spend, in micros, of the user's family since `monthStart` (their own when they have no
   * family). Every member's calls count, whoever asks.
   */
  familySpendMicros(userId: string, monthStart: Date): Promise<number>;
  /** Everyone's spend, in micros, since `monthStart`. */
  globalSpendMicros(monthStart: Date): Promise<number>;
  /** Writes a ledger row, stamped with the user's family at this moment. */
  insertUsage(record: AiUsageRecord): Promise<void>;
  /** Turns the kill switch on or off, recording no user. */
  setEnabled(enabled: boolean): Promise<void>;
  budgetRecipients(userId: string): Promise<BudgetRecipients>;
  /** Queues a notification; a `dedupeKey` that is already queued is `duplicate` and changes nothing. */
  enqueueNotification(notification: NewNotification): Promise<"queued" | "duplicate">;
}

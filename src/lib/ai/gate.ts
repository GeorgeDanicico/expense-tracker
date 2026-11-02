import "server-only";

import { getAdminUserIds, getAiLimits, MICROS_PER_USD, type AiLimits } from "@/lib/ai/config";
import { aiMonthAt, formatResetDay, type AiMonth } from "@/lib/ai/month";
import type { AiGateRepository, AiOutcome } from "@/lib/ai/repository";
import { DomainError } from "@/lib/errors";
import type { NewNotification } from "@/lib/notifications/worker-store";
import { getRepositories } from "@/lib/repositories";

/**
 * The AI gate (docs/statement-import-plan.md, I14; roadmap 8.1): the checks every model call passes
 * before it is made, and the ledger entry after it. No model and no SDK in here; the entry point
 * that calls a provider (I15) wraps `reserveBudget` and `settleUsage` around the call.
 *
 * The kill switch is `app_flags.ai_enabled`. A call needs the switch on, the user's opt-in
 * (`profiles.ai_enabled`, and for a kid the `ai` permission), and room in two budgets: the user's
 * family's calendar month in Europe/Bucharest (`AI_FAMILY_MONTHLY_USD`, default $3; a user without
 * a family is a family of one) and everyone's month (`AI_MONTHLY_BUDGET_USD`, default $10). Money is
 * counted in micros, millionths of a dollar.
 *
 * The check and the call's worst case are written to the ledger together, as a reservation, before
 * the call (S10). The database does both under a lock on the family's month and one on everyone's,
 * so two calls at the same moment are checked one after the other and the second counts the first:
 * parallel uploads can't all pass the same check. After the call, the reservation is settled to what
 * the call really cost.
 */

/** Why the gate refused. */
export type AiGateReason =
  /** The kill switch is off for everyone. */
  | "flag_off"
  /** The user hasn't turned AI on in Settings. */
  | "not_opted_in"
  /** A kid whose parent hasn't allowed AI. */
  | "not_permitted"
  /** The user's family's month (or the user's own, without a family) has no room for the call. */
  | "family_budget"
  /** Everyone's month has no room for the call. */
  | "global_budget";

/** A call the gate refused, with the words to show and, for a budget, which limit and when it resets. */
export class AiGateError extends DomainError {
  readonly reason: AiGateReason;
  /** The limit that stopped the call; only for `family_budget` and `global_budget`. */
  readonly limit?: "family" | "global";
  readonly limitMicros?: number;
  readonly spentMicros?: number;
  /** When the budget starts again: the 1st of next month, midnight in Bucharest. */
  readonly resetsAt?: Date;

  constructor(
    reason: AiGateReason,
    message: string,
    budget?: { limit: "family" | "global"; limitMicros: number; spentMicros: number; resetsAt: Date },
  ) {
    super(message, 403);
    this.name = "AiGateError";
    this.reason = reason;
    if (budget) {
      this.limit = budget.limit;
      this.limitMicros = budget.limitMicros;
      this.spentMicros = budget.spentMicros;
      this.resetsAt = budget.resetsAt;
    }
  }
}

/** The pieces the gate uses, replaceable in tests. */
export type AiGateDependencies = {
  repository?: AiGateRepository;
  limits?: AiLimits;
  /** Who is told when the global budget turns AI off. Defaults to `APP_ADMIN_USER_IDS`. */
  adminUserIds?: readonly string[];
  now?: () => Date;
  /** Where follow-up failures are reported. Defaults to `console.error`. */
  log?: (message: string, error: unknown) => void;
};

export type ReserveBudgetInput = {
  userId: string;
  /** A short lowercase key for what the call is for, such as `statements`. */
  feature: string;
  /** The provider and model the call will use, recorded on the reservation. */
  provider: string;
  model: string;
  /** The worst case the call could cost: its input plus its full output cap at the output price. */
  estimatedMicros: number;
};

/** What `reserveBudget` found, for a caller that wants to show or log it. */
export type BudgetCheck = {
  month: AiMonth;
  /** The month's spend before this call. */
  familySpentMicros: number;
  familyLimitMicros: number;
  globalSpentMicros: number;
  globalLimitMicros: number;
};

/** A reservation the call must be settled against with `settleUsage`. */
export type BudgetReservation = BudgetCheck & { reservationId: string };

const FEATURE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function usd(micros: number) {
  return `$${(micros / MICROS_PER_USD).toFixed(2)}`;
}

function assertMicros(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a whole number of micros, zero or more.`);
}

function resolve(dependencies: AiGateDependencies) {
  return {
    repository: dependencies.repository ?? getRepositories().aiGate,
    limits: dependencies.limits ?? getAiLimits(),
    now: dependencies.now ?? (() => new Date()),
    log: dependencies.log ?? ((message: string, error: unknown) => console.error(message, error instanceof Error ? error.message : error)),
  };
}

/**
 * Refuses (throws an {@link AiGateError}) unless the call may go ahead: the kill switch is on, the
 * user has opted in (and a kid has the permission), and `estimatedMicros` fits what is left of the
 * user's family's month and of everyone's month. A spend that has reached a limit refuses even a
 * free call. When it may go ahead, its worst case is already counted in both months: settle it with
 * `settleUsage` after the call, whatever happens to the call.
 *
 * One round trip, checked and reserved atomically. The user must be the signed-in caller.
 */
export async function reserveBudget(input: ReserveBudgetInput, dependencies: AiGateDependencies = {}): Promise<BudgetReservation> {
  const { userId, feature, provider, model, estimatedMicros } = input;
  if (!userId) throw new TypeError("reserveBudget needs a user.");
  if (!FEATURE_PATTERN.test(feature)) throw new TypeError("A feature is a short lowercase key.");
  assertMicros("estimatedMicros", estimatedMicros);

  const { repository, limits, now } = resolve(dependencies);
  const month = aiMonthAt(now());

  const reservation = await repository.reserve({
    userId,
    feature,
    provider,
    model,
    estimatedMicros,
    monthStart: month.start,
    familyLimitMicros: limits.familyMonthlyMicros,
    globalLimitMicros: limits.globalMonthlyMicros,
  });

  switch (reservation.status) {
    case "flag_off":
      throw new AiGateError("flag_off", "AI features are paused for everyone right now.");
    case "not_permitted":
      throw new AiGateError("not_permitted", "A parent needs to turn on AI features for you.");
    case "ai_off":
      throw new AiGateError("not_opted_in", "Turn on AI features in Settings to use this.");
    case "family_budget":
      throw new AiGateError("family_budget", budgetMessage("This month's AI budget", limits.familyMonthlyMicros, reservation.familySpentMicros, month), {
        limit: "family",
        limitMicros: limits.familyMonthlyMicros,
        spentMicros: reservation.familySpentMicros,
        resetsAt: month.resetsAt,
      });
    case "global_budget":
      throw new AiGateError("global_budget", budgetMessage("The app's AI budget for this month", limits.globalMonthlyMicros, reservation.globalSpentMicros, month), {
        limit: "global",
        limitMicros: limits.globalMonthlyMicros,
        spentMicros: reservation.globalSpentMicros,
        resetsAt: month.resetsAt,
      });
  }

  return {
    reservationId: reservation.reservationId,
    month,
    familySpentMicros: reservation.familySpentMicros,
    familyLimitMicros: limits.familyMonthlyMicros,
    globalSpentMicros: reservation.globalSpentMicros,
    globalLimitMicros: limits.globalMonthlyMicros,
  };
}

function budgetMessage(what: string, limitMicros: number, spentMicros: number, month: AiMonth) {
  const reset = `It starts again on ${formatResetDay(month.resetsAt)}.`;
  if (spentMicros >= limitMicros) return `${what} (${usd(limitMicros)}) is used up. ${reset}`;
  return `${what} has ${usd(limitMicros - spentMicros)} of ${usd(limitMicros)} left, which isn't enough for this request. ${reset}`;
}

export type SettleUsageInput = {
  /** From `reserveBudget`. */
  reservationId: string;
  userId: string;
  /**
   * `ok`, or how the call failed. Failed and refused calls are settled too: the provider may still
   * have billed them. A call that never reached the provider is settled as `provider_error` at zero.
   */
  outcome: AiOutcome;
  /** Zero when the provider billed nothing or reported nothing. */
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /** The call's real cost, priced from the pricing table, in micros. */
  costMicros?: number;
};

/** What `settleUsage` did after settling the ledger row. */
export type UsageRecorded = {
  /** The family's spend this month, this call included. */
  familySpentMicros: number;
  globalSpentMicros: number;
  /** The warning queued for the family's parents (or the user alone): 80 or 100, else null. */
  warned: 80 | 100 | null;
  /** The call took everyone's month to the backstop and turned the kill switch off. */
  switchedOff: boolean;
};

/**
 * Settles a reservation to the finished call's real tokens and cost, whatever its outcome. A failure
 * to settle it throws: the ledger would otherwise keep the worst case, or miss a real cost above it.
 *
 * Then, only when the call cost something, it looks at the month the settlement returned. When the
 * family's month has reached 80% or 100% of its limit it queues a notification to the family's
 * parents (the user alone without a family), once per month and level (a dedupe key). When
 * everyone's month has reached the backstop it turns `app_flags.ai_enabled` off and notifies the
 * admins in `APP_ADMIN_USER_IDS`. A failure in that follow-up is logged and not thrown: the call
 * already happened and is recorded, and the next `reserveBudget` refuses on the spend itself.
 */
export async function settleUsage(input: SettleUsageInput, dependencies: AiGateDependencies = {}): Promise<UsageRecorded> {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const cachedInputTokens = input.cachedInputTokens ?? 0;
  const costMicros = input.costMicros ?? 0;
  if (!input.reservationId) throw new TypeError("settleUsage needs a reservation.");
  if (!input.userId) throw new TypeError("settleUsage needs a user.");
  assertMicros("inputTokens", inputTokens);
  assertMicros("outputTokens", outputTokens);
  assertMicros("cachedInputTokens", cachedInputTokens);
  assertMicros("costMicros", costMicros);

  const { repository, limits, now, log } = resolve(dependencies);
  const month = aiMonthAt(now());
  const spend = await repository.settle({
    reservationId: input.reservationId,
    userId: input.userId,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costMicros,
    outcome: input.outcome,
    monthStart: month.start,
  });

  const result: UsageRecorded = { ...spend, warned: null, switchedOff: false };
  if (costMicros === 0) return result;

  try {
    const level = warningLevel(spend.familySpentMicros, limits.familyMonthlyMicros);
    if (level) {
      await warnFamily(repository, input.userId, level, spend.familySpentMicros, limits.familyMonthlyMicros, month);
      result.warned = level;
    }
  } catch (error) {
    log("AI gate: could not warn the family about its budget after a call.", error);
  }

  try {
    if (spend.globalSpentMicros >= limits.globalMonthlyMicros) {
      if (await repository.isEnabled()) {
        await repository.setEnabled(false);
        result.switchedOff = true;
      }
      await warnAdmins(repository, dependencies.adminUserIds ?? getAdminUserIds(), limits.globalMonthlyMicros, month, log);
    }
  } catch (error) {
    log("AI gate: could not check the global budget after a call.", error);
  }

  return result;
}

/**
 * The warning a month's spend calls for: 100 once it has reached the limit, else 80 once it has
 * reached four fifths of it. Only the highest level counts, so a call that jumps past 80% straight
 * to the limit sends one notification. Integer maths, no rounding.
 */
function warningLevel(spentMicros: number, limitMicros: number): 80 | 100 | null {
  if (spentMicros >= limitMicros) return 100;
  if (spentMicros * 5 >= limitMicros * 4) return 80;
  return null;
}

/**
 * Queues the warning for each recipient. The dedupe key names the family (or the user), the month,
 * the level and the recipient, so repeating this on every later call of the month queues nothing new.
 */
async function warnFamily(
  repository: AiGateRepository,
  userId: string,
  level: 80 | 100,
  spentMicros: number,
  limitMicros: number,
  month: AiMonth,
) {
  const { familyId, userIds } = await repository.budgetRecipients(userId);
  const who = familyId ? `family:${familyId}` : `user:${userId}`;
  const subject = familyId ? "Your family has" : "You have";
  const notification = (recipient: string): NewNotification => ({
    userId: recipient,
    kind: "ai_budget",
    dedupeKey: `ai_budget:${who}:${month.key}:${level}:${recipient}`,
    payload:
      level === 100
        ? {
            title: "AI budget used up",
            body: `${subject} used the ${usd(limitMicros)} AI budget for this month. AI is paused until ${formatResetDay(month.resetsAt)}.`,
            url: "/settings",
            tag: "ai-budget",
          }
        : {
            title: "AI budget at 80%",
            body: `${subject} used ${usd(spentMicros)} of the ${usd(limitMicros)} AI budget this month.`,
            url: "/settings",
            tag: "ai-budget",
          },
  });
  for (const recipient of userIds) await repository.enqueueNotification(notification(recipient));
}

async function warnAdmins(
  repository: AiGateRepository,
  adminUserIds: readonly string[],
  limitMicros: number,
  month: AiMonth,
  log: (message: string, error: unknown) => void,
) {
  for (const admin of adminUserIds) {
    try {
      await repository.enqueueNotification({
        userId: admin,
        kind: "ai_budget",
        dedupeKey: `ai_budget:global:${month.key}:${admin}`,
        payload: {
          title: "AI turned off for everyone",
          body: `The ${usd(limitMicros)} monthly AI budget was reached, so AI is off until you turn it back on.`,
          url: "/settings",
          tag: "ai-budget-global",
        },
      });
    } catch (error) {
      log("AI gate: could not notify an admin.", error);
    }
  }
}

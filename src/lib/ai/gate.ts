import "server-only";

import { getAdminUserIds, getAiLimits, MICROS_PER_USD, type AiLimits } from "@/lib/ai/config";
import { aiMonthAt, formatResetDay, type AiMonth } from "@/lib/ai/month";
import type { AiGateRepository, AiOutcome, AiUsageRecord } from "@/lib/ai/repository";
import { DomainError } from "@/lib/errors";
import type { NewNotification } from "@/lib/notifications/worker-store";
import { getRepositories } from "@/lib/repositories";

/**
 * The AI gate (docs/statement-import-plan.md, I14; roadmap 8.1): the checks every model call passes
 * before it is made, and the ledger entry after it. No model and no SDK in here; the entry point
 * that calls a provider (I15) wraps `checkBudget` and `recordUsage` around the call.
 *
 * The kill switch is `app_flags.ai_enabled`. A call needs the switch on, the user's opt-in
 * (`profiles.ai_enabled`, and for a kid the `ai` permission), and room in two budgets: the user's
 * family's calendar month in Europe/Bucharest (`AI_FAMILY_MONTHLY_USD`, default $3; a user without
 * a family is a family of one) and everyone's month (`AI_MONTHLY_BUDGET_USD`, default $10). Money is
 * counted in micros, millionths of a dollar.
 *
 * Two calls from one family at the same moment can both pass the check. The overshoot is at most one
 * call's worst case, and the next check sees it. That is accepted rather than locking.
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

export type CheckBudgetInput = {
  userId: string;
  /** A short lowercase key for what the call is for, such as `statements`. */
  feature: string;
  /** The worst case the call could cost: its input plus its full output cap at the output price. */
  estimatedMicros: number;
};

/** What `checkBudget` found, for a caller that wants to show or log it. */
export type BudgetCheck = {
  month: AiMonth;
  familySpentMicros: number;
  familyLimitMicros: number;
  globalSpentMicros: number;
  globalLimitMicros: number;
};

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
 * free call. Reads nothing after the first reason to refuse.
 *
 * The user must be the signed-in caller: the opt-in and the family's total are read as them.
 */
export async function checkBudget(input: CheckBudgetInput, dependencies: AiGateDependencies = {}): Promise<BudgetCheck> {
  const { userId, feature, estimatedMicros } = input;
  if (!userId) throw new TypeError("checkBudget needs a user.");
  if (!FEATURE_PATTERN.test(feature)) throw new TypeError("A feature is a short lowercase key.");
  assertMicros("estimatedMicros", estimatedMicros);

  const { repository, limits, now } = resolve(dependencies);
  const month = aiMonthAt(now());

  if (!(await repository.isEnabled())) {
    throw new AiGateError("flag_off", "AI features are paused for everyone right now.");
  }

  const access = await repository.access(userId);
  if (access === "not_permitted") throw new AiGateError("not_permitted", "A parent needs to turn on AI features for you.");
  if (access !== "ok") throw new AiGateError("not_opted_in", "Turn on AI features in Settings to use this.");

  const familySpentMicros = await repository.familySpendMicros(userId, month.start);
  if (familySpentMicros >= limits.familyMonthlyMicros || familySpentMicros + estimatedMicros > limits.familyMonthlyMicros) {
    throw new AiGateError("family_budget", budgetMessage("This month's AI budget", limits.familyMonthlyMicros, familySpentMicros, month), {
      limit: "family",
      limitMicros: limits.familyMonthlyMicros,
      spentMicros: familySpentMicros,
      resetsAt: month.resetsAt,
    });
  }

  const globalSpentMicros = await repository.globalSpendMicros(month.start);
  if (globalSpentMicros >= limits.globalMonthlyMicros || globalSpentMicros + estimatedMicros > limits.globalMonthlyMicros) {
    throw new AiGateError("global_budget", budgetMessage("The app's AI budget for this month", limits.globalMonthlyMicros, globalSpentMicros, month), {
      limit: "global",
      limitMicros: limits.globalMonthlyMicros,
      spentMicros: globalSpentMicros,
      resetsAt: month.resetsAt,
    });
  }

  return {
    month,
    familySpentMicros,
    familyLimitMicros: limits.familyMonthlyMicros,
    globalSpentMicros,
    globalLimitMicros: limits.globalMonthlyMicros,
  };
}

function budgetMessage(what: string, limitMicros: number, spentMicros: number, month: AiMonth) {
  const reset = `It starts again on ${formatResetDay(month.resetsAt)}.`;
  if (spentMicros >= limitMicros) return `${what} (${usd(limitMicros)}) is used up. ${reset}`;
  return `${what} has ${usd(limitMicros - spentMicros)} of ${usd(limitMicros)} left, which isn't enough for this request. ${reset}`;
}

export type RecordUsageInput = {
  userId: string;
  feature: string;
  provider: string;
  model: string;
  /** `ok`, or how the call failed. Failed and refused calls are recorded too: the provider may still have billed them. */
  outcome: AiOutcome;
  /** Zero when the provider billed nothing or reported nothing. */
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /** The call's real cost, priced from the pricing table, in micros. */
  costMicros?: number;
};

/** What `recordUsage` did after writing the ledger row. */
export type UsageRecorded = {
  /** The family's spend this month, this call included; null when nothing was read (a free call). */
  familySpentMicros: number | null;
  globalSpentMicros: number | null;
  /** The warning queued for the family's parents (or the user alone): 80 or 100, else null. */
  warned: 80 | 100 | null;
  /** The call took everyone's month to the backstop and turned the kill switch off. */
  switchedOff: boolean;
};

/**
 * Writes the ledger row for a finished call, the real tokens and cost, whatever its outcome. A
 * failure to write it throws: the spend would otherwise go uncounted.
 *
 * Then, only when the call cost something, it looks at the month. When the family's month has
 * reached 80% or 100% of its limit it queues a notification to the family's parents (the user
 * alone without a family), once per month and level (a dedupe key). When everyone's month has
 * reached the backstop it turns `app_flags.ai_enabled` off and notifies the admins in
 * `APP_ADMIN_USER_IDS`. A failure in that follow-up is logged and not thrown: the call already
 * happened and is recorded, and the next `checkBudget` refuses on the spend itself.
 *
 * The user must be the signed-in caller.
 */
export async function recordUsage(input: RecordUsageInput, dependencies: AiGateDependencies = {}): Promise<UsageRecorded> {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const cachedInputTokens = input.cachedInputTokens ?? 0;
  const costMicros = input.costMicros ?? 0;
  if (!input.userId) throw new TypeError("recordUsage needs a user.");
  if (!FEATURE_PATTERN.test(input.feature)) throw new TypeError("A feature is a short lowercase key.");
  assertMicros("inputTokens", inputTokens);
  assertMicros("outputTokens", outputTokens);
  assertMicros("cachedInputTokens", cachedInputTokens);
  assertMicros("costMicros", costMicros);

  const { repository, limits, now, log } = resolve(dependencies);
  const record: AiUsageRecord = {
    userId: input.userId,
    feature: input.feature,
    provider: input.provider,
    model: input.model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costMicros,
    outcome: input.outcome,
  };
  await repository.insertUsage(record);

  const result: UsageRecorded = { familySpentMicros: null, globalSpentMicros: null, warned: null, switchedOff: false };
  if (costMicros === 0) return result;

  const month = aiMonthAt(now());

  try {
    result.familySpentMicros = await repository.familySpendMicros(input.userId, month.start);
    const level = warningLevel(result.familySpentMicros, limits.familyMonthlyMicros);
    if (level) {
      await warnFamily(repository, input.userId, level, result.familySpentMicros, limits.familyMonthlyMicros, month);
      result.warned = level;
    }
  } catch (error) {
    log("AI gate: could not check the family's budget after a call.", error);
  }

  try {
    result.globalSpentMicros = await repository.globalSpendMicros(month.start);
    if (result.globalSpentMicros >= limits.globalMonthlyMicros) {
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

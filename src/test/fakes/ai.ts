// Types only: `@/lib/ai/gate` imports `@/lib/repositories`, which route tests replace with
// `./repositories`, which imports this file. A value import here would be a cycle that never loads.
import type { AiGateDependencies, BudgetCheck, CheckBudgetInput, RecordUsageInput, UsageRecorded } from "@/lib/ai/gate";
import type { AiAccess, AiGateRepository, AiOutcome, AiUsageRecord, BudgetRecipients } from "@/lib/ai/repository";
import type { NewNotification } from "@/lib/notifications/worker-store";

/** What the fake knows about a user. */
export type FakeAiUser = {
  /** The family the user is in now, or null. */
  familyId: string | null;
  role: "parent" | "kid";
  /** `profiles.ai_enabled`. */
  optedIn: boolean;
  /** For a kid: whether the `ai` permission is on. Ignored for a parent. */
  kidAiPermission: boolean;
};

/** A ledger row as the fake keeps it. */
export type FakeUsageRow = AiUsageRecord & { familyId: string | null; createdAt: Date };

/**
 * In-memory `AiGateRepository`, following the SQL's rules: a family's month is the rows stamped with
 * its id (a member who left keeps their past rows in it, a member who joins brings none), and a user
 * without a family counts their own rows made without one. `now` is the clock that stamps rows;
 * `users` holds each user's family, role and opt-in (a user missing from it is an adult with no
 * family who hasn't opted in). `calls` records every method call.
 */
export class FakeAiGateRepository implements AiGateRepository {
  /** `app_flags.ai_enabled`. */
  enabled = true;
  readonly users = new Map<string, FakeAiUser>();
  usage: FakeUsageRow[] = [];
  notifications: (NewNotification & { createdAt: Date })[] = [];
  now = () => new Date();
  readonly calls: (keyof AiGateRepository)[] = [];
  /** Methods that throw, to test the gate's handling of a failing store. */
  failing = new Set<keyof AiGateRepository>();

  /** Adds or updates a user. */
  setUser(userId: string, patch: Partial<FakeAiUser> = {}): FakeAiUser {
    const user: FakeAiUser = {
      ...(this.users.get(userId) ?? { familyId: null, role: "parent", optedIn: false, kidAiPermission: false }),
      ...patch,
    };
    this.users.set(userId, user);
    return user;
  }

  /** Adds a ledger row directly, as if a call had been recorded at `at`, in the user's current family unless given. */
  seedUsage(userId: string, costMicros: number, at: Date, overrides: Partial<FakeUsageRow> = {}): FakeUsageRow {
    const row: FakeUsageRow = {
      userId,
      familyId: this.users.get(userId)?.familyId ?? null,
      feature: "statements",
      provider: "fake",
      model: "fake-model",
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costMicros,
      outcome: "ok",
      createdAt: at,
      ...overrides,
    };
    this.usage.push(row);
    return row;
  }

  private call(method: keyof AiGateRepository) {
    this.calls.push(method);
    if (this.failing.has(method)) throw new Error(`The fake ${method} failed.`);
  }

  async isEnabled() {
    this.call("isEnabled");
    return this.enabled;
  }

  async access(userId: string): Promise<AiAccess> {
    this.call("access");
    const user = this.users.get(userId);
    if (user?.role === "kid" && user.familyId && !user.kidAiPermission) return "not_permitted";
    return user?.optedIn ? "ok" : "ai_off";
  }

  async familySpendMicros(userId: string, monthStart: Date) {
    this.call("familySpendMicros");
    const familyId = this.users.get(userId)?.familyId ?? null;
    return this.usage
      .filter((row) => row.createdAt >= monthStart)
      .filter((row) => (familyId ? row.familyId === familyId : row.userId === userId && row.familyId === null))
      .reduce((sum, row) => sum + row.costMicros, 0);
  }

  async globalSpendMicros(monthStart: Date) {
    this.call("globalSpendMicros");
    return this.usage.filter((row) => row.createdAt >= monthStart).reduce((sum, row) => sum + row.costMicros, 0);
  }

  async insertUsage(record: AiUsageRecord) {
    this.call("insertUsage");
    this.usage.push({ ...record, familyId: this.users.get(record.userId)?.familyId ?? null, createdAt: this.now() });
  }

  async setEnabled(enabled: boolean) {
    this.call("setEnabled");
    this.enabled = enabled;
  }

  async budgetRecipients(userId: string): Promise<BudgetRecipients> {
    this.call("budgetRecipients");
    const familyId = this.users.get(userId)?.familyId ?? null;
    if (!familyId) return { familyId, userIds: [userId] };
    const parents = [...this.users].filter(([, user]) => user.familyId === familyId && user.role === "parent").map(([id]) => id);
    return { familyId, userIds: parents.length > 0 ? parents : [userId] };
  }

  async enqueueNotification(notification: NewNotification) {
    this.call("enqueueNotification");
    if (this.notifications.some((queued) => queued.dedupeKey === notification.dedupeKey)) return "duplicate" as const;
    this.notifications.push({ ...notification, createdAt: this.now() });
    return "queued" as const;
  }
}

/** The tokens and cost a scripted fake call reports. */
export type FakeModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /** Millionths of a dollar. */
  costMicros: number;
};

type FakeModelStep = { outcome: AiOutcome; usage: FakeModelUsage | null };

/** The two gate functions a fake model runs around its "call": `checkBudget` and `recordUsage` from `@/lib/ai/gate`. */
export type FakeModelGate = {
  checkBudget(input: CheckBudgetInput, dependencies: AiGateDependencies): Promise<BudgetCheck>;
  recordUsage(input: RecordUsageInput, dependencies: AiGateDependencies): Promise<UsageRecorded>;
};

export type FakeModelResult = { ok: true } | { ok: false; reason: Exclude<AiOutcome, "ok"> };

/**
 * A model that makes no call: it takes the next scripted result and reports its usage, so tests can
 * run the whole gate sequence the real entry point will run (`checkBudget`, the call, `recordUsage`)
 * with chosen costs and failures. With nothing scripted a call succeeds at no cost. `calls` lists the
 * calls that got past the gate. It is given the gate's functions rather than importing them, so this
 * file stays free of the production repositories (see the note at the top).
 */
export class FakeModel {
  readonly provider = "fake";
  readonly model = "fake-model";
  readonly calls: { userId: string; feature: string }[] = [];
  private script: FakeModelStep[] = [];

  constructor(private readonly gate: FakeModelGate) {}

  /** The next call succeeds and costs this much. */
  willSucceed(usage: FakeModelUsage) {
    this.script.push({ outcome: "ok", usage });
    return this;
  }

  /** The next call fails with `reason`; the provider billed `usage` for it, or nothing (null). */
  willFail(reason: Exclude<AiOutcome, "ok">, usage: FakeModelUsage | null = null) {
    this.script.push({ outcome: reason, usage });
    return this;
  }

  /**
   * Checks the budget (throwing the gate's `AiGateError` when refused, before any call), "calls" the
   * model, and records the usage whatever the outcome.
   */
  async call(input: CheckBudgetInput, dependencies: AiGateDependencies): Promise<FakeModelResult> {
    await this.gate.checkBudget(input, dependencies);
    this.calls.push({ userId: input.userId, feature: input.feature });

    const step = this.script.shift() ?? { outcome: "ok" as const, usage: null };
    await this.gate.recordUsage(
      {
        userId: input.userId,
        feature: input.feature,
        provider: this.provider,
        model: this.model,
        outcome: step.outcome,
        inputTokens: step.usage?.inputTokens,
        outputTokens: step.usage?.outputTokens,
        cachedInputTokens: step.usage?.cachedInputTokens,
        costMicros: step.usage?.costMicros ?? 0,
      },
      dependencies,
    );
    return step.outcome === "ok" ? { ok: true } : { ok: false, reason: step.outcome };
  }
}

// Types only, and nothing from `@/lib/ai/gate`: it imports `@/lib/repositories`, which route tests
// replace with `./repositories`, which imports this file. A value import of the gate here would be a
// cycle that never loads. The fake model moved to `src/lib/ai/providers/fake.ts` (I15).
import type { AiAccess, AiGateRepository, AiUsageRecord, BudgetRecipients } from "@/lib/ai/repository";
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

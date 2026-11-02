// Types only, and nothing from `@/lib/ai/gate`: it imports `@/lib/repositories`, which route tests
// replace with `./repositories`, which imports this file. A value import of the gate here would be a
// cycle that never loads. The fake model moved to `src/lib/ai/providers/fake.ts` (I15).
import { DomainError } from "@/lib/errors";
import type { AiAccess, AiGateRepository, AiOutcome, AiReservation, AiReservationRequest, AiSettlement, BudgetRecipients } from "@/lib/ai/repository";
import type { NewNotification } from "@/lib/notifications/worker-store";

// The SQL's message (supabase/migrations/20261030000100_create_ai_gate.sql).
const NOT_PERMITTED = "A parent needs to turn on AI features for you.";

/** Whether an estimate fits what is left of a month, as the gate has always counted it. */
const fits = (spentMicros: number, estimatedMicros: number, limitMicros: number) =>
  spentMicros < limitMicros && spentMicros + estimatedMicros <= limitMicros;

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

/** A ledger row as the fake keeps it: a reservation (`reserved`) until it is settled. */
export type FakeUsageRow = {
  id: string;
  userId: string;
  familyId: string | null;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicros: number;
  outcome: AiOutcome | "reserved";
  createdAt: Date;
};

/**
 * In-memory `AiGateRepository`, following the SQL's rules: a family's month is the rows stamped with
 * its id (a member who left keeps their past rows in it, a member who joins brings none), a user
 * without a family counts their own rows made without one, and a reservation counts its worst case
 * until it is settled. `now` is the clock that stamps rows;
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
      id: crypto.randomUUID(),
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
    return this.accessOf(userId);
  }

  private accessOf(userId: string): AiAccess {
    const user = this.users.get(userId);
    if (user?.role === "kid" && user.familyId && !user.kidAiPermission) return "not_permitted";
    return user?.optedIn ? "ok" : "ai_off";
  }

  /** Like the switch guard: a kid without the `ai` permission can't turn it on; turning it off always works. */
  async setOptIn(userId: string, enabled: boolean) {
    this.call("setOptIn");
    const user = this.users.get(userId) ?? this.setUser(userId);
    if (enabled && !user.optedIn && user.role === "kid" && user.familyId && !user.kidAiPermission) {
      throw new DomainError(NOT_PERMITTED, 403);
    }
    user.optedIn = enabled;
  }

  /**
   * Like the permission sync trigger: a kid whose `ai` permission goes off has the switch turned off
   * too. Tests call it where the family editor would save the permission.
   */
  setKidAiPermission(userId: string, permitted: boolean) {
    const user = this.setUser(userId, { kidAiPermission: permitted });
    if (!permitted && user.role === "kid") user.optedIn = false;
  }

  /**
   * Like `ai_reserve_budget`. Nothing awaits between the check and the write, so two reservations
   * made at once are checked one after the other, as the SQL's locks make them.
   */
  async reserve(request: AiReservationRequest): Promise<AiReservation> {
    this.call("reserve");
    if (!this.enabled) return { status: "flag_off" };
    const access = this.accessOf(request.userId);
    if (access !== "ok") return { status: access };

    const familyId = this.users.get(request.userId)?.familyId ?? null;
    const familySpentMicros = this.familySpend(request.userId, familyId, request.monthStart);
    if (!fits(familySpentMicros, request.estimatedMicros, request.familyLimitMicros)) return { status: "family_budget", familySpentMicros };
    const globalSpentMicros = this.globalSpend(request.monthStart);
    if (!fits(globalSpentMicros, request.estimatedMicros, request.globalLimitMicros)) return { status: "global_budget", familySpentMicros, globalSpentMicros };

    const row = this.seedUsage(request.userId, request.estimatedMicros, this.now(), {
      feature: request.feature, provider: request.provider, model: request.model, outcome: "reserved",
    });
    return { status: "ok", reservationId: row.id, familySpentMicros, globalSpentMicros };
  }

  /** Like `ai_settle_usage`: a reservation of the user's is settled once; anything else throws. */
  async settle(settlement: AiSettlement) {
    this.call("settle");
    const row = this.usage.find((stored) => stored.id === settlement.reservationId && stored.userId === settlement.userId && stored.outcome === "reserved");
    if (!row) throw new Error("That AI reservation wasn't found or was already settled.");
    Object.assign(row, {
      inputTokens: settlement.inputTokens,
      outputTokens: settlement.outputTokens,
      cachedInputTokens: settlement.cachedInputTokens,
      costMicros: settlement.costMicros,
      outcome: settlement.outcome,
    });
    return {
      familySpentMicros: this.familySpend(row.userId, row.familyId, settlement.monthStart),
      globalSpentMicros: this.globalSpend(settlement.monthStart),
    };
  }

  /** The rows of a family's month, or of the user's own without a family, as the SQL counts them. */
  private familySpend(userId: string, familyId: string | null, monthStart: Date) {
    return this.usage
      .filter((row) => row.createdAt >= monthStart)
      .filter((row) => (familyId ? row.familyId === familyId : row.userId === userId && row.familyId === null))
      .reduce((sum, row) => sum + row.costMicros, 0);
  }

  private globalSpend(monthStart: Date) {
    return this.usage.filter((row) => row.createdAt >= monthStart).reduce((sum, row) => sum + row.costMicros, 0);
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

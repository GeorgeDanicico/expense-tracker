import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkBudget, recordUsage, AiGateError, type AiGateDependencies } from "@/lib/ai/gate";
import { FakeAiGateRepository, FakeModel } from "@/test/fakes/ai";

// A family of two parents and a kid, a kid without a permission, and two users without a family.
const mum = "10000000-0000-4000-8000-000000000141";
const dad = "10000000-0000-4000-8000-000000000142";
const kid = "10000000-0000-4000-8000-000000000143";
const lockedKid = "10000000-0000-4000-8000-000000000144";
const solo = "10000000-0000-4000-8000-000000000145";
const otherSolo = "10000000-0000-4000-8000-000000000146";
const outsider = "10000000-0000-4000-8000-000000000147";
const otherFamily = "20000000-0000-4000-8000-000000000141";
const family = "20000000-0000-4000-8000-000000000142";
const admin = "10000000-0000-4000-8000-0000000000ad";

const USD = 1_000_000;
// Bucharest is UTC+3 until 25 October 2026 and UTC+2 after, so the months begin at these instants.
const OCTOBER = new Date("2026-09-30T21:00:00Z");
const NOVEMBER = new Date("2026-10-31T22:00:00Z");
const MID_OCTOBER = new Date("2026-10-15T10:00:00Z");
const LIMITS = { familyMonthlyMicros: 3 * USD, globalMonthlyMicros: 10 * USD };

let repository: FakeAiGateRepository;
let now: Date;
let logged: string[];

function dependencies(overrides: Partial<AiGateDependencies> = {}): AiGateDependencies {
  return {
    repository,
    limits: LIMITS,
    now: () => now,
    adminUserIds: [admin],
    log: (message) => logged.push(message),
    ...overrides,
  };
}

function check(userId: string, estimatedMicros = 10_000, overrides: Partial<AiGateDependencies> = {}) {
  return checkBudget({ userId, feature: "statements", estimatedMicros }, dependencies(overrides));
}

function record(userId: string, costMicros: number, overrides: Partial<Parameters<typeof recordUsage>[0]> = {}) {
  return recordUsage(
    { userId, feature: "statements", provider: "fake", model: "fake-model", outcome: "ok", costMicros, ...overrides },
    dependencies(),
  );
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AiGateError);
  return error as AiGateError;
}

beforeEach(() => {
  now = MID_OCTOBER;
  logged = [];
  repository = new FakeAiGateRepository();
  repository.now = () => now;
  repository.setUser(mum, { familyId: family, role: "parent", optedIn: true });
  repository.setUser(dad, { familyId: family, role: "parent", optedIn: true });
  repository.setUser(kid, { familyId: family, role: "kid", optedIn: true, kidAiPermission: true });
  repository.setUser(lockedKid, { familyId: family, role: "kid", optedIn: true, kidAiPermission: false });
  repository.setUser(solo, { optedIn: true });
  repository.setUser(otherSolo, { optedIn: true });
  repository.setUser(outsider, { familyId: otherFamily, role: "parent", optedIn: true });
});

describe("checkBudget", () => {
  it("lets a call through and reports the month's numbers", async () => {
    repository.seedUsage(mum, 1 * USD, new Date("2026-10-02T10:00:00Z"));
    repository.seedUsage(outsider, 2 * USD, new Date("2026-10-03T10:00:00Z"));

    const budget = await check(kid);

    expect(budget).toMatchObject({
      familySpentMicros: 1 * USD,
      familyLimitMicros: 3 * USD,
      globalSpentMicros: 3 * USD,
      globalLimitMicros: 10 * USD,
    });
    expect(budget.month.key).toBe("2026-10");
    expect(budget.month.start).toEqual(OCTOBER);
    expect(budget.month.resetsAt).toEqual(NOVEMBER);
  });

  describe("the kill switch and the opt-in", () => {
    it("refuses everyone while the flag is off, and reads nothing else", async () => {
      repository.enabled = false;

      const error = await refusal(check(mum));

      expect(error.reason).toBe("flag_off");
      expect(error.status).toBe(403);
      expect(repository.calls).toEqual(["isEnabled"]);
    });

    it("refuses a user who hasn't opted in", async () => {
      repository.setUser(solo, { optedIn: false });

      const error = await refusal(check(solo));

      expect(error.reason).toBe("not_opted_in");
      expect(error.message).toMatch(/Settings/);
      expect(repository.calls).toEqual(["isEnabled", "access"]);
    });

    it("refuses a kid whose parent hasn't allowed AI, even with the switch on", async () => {
      const error = await refusal(check(lockedKid));

      expect(error.reason).toBe("not_permitted");
      expect(error.message).toMatch(/parent/);
    });

    it("lets a kid with the permission and the switch through", async () => {
      await expect(check(kid)).resolves.toBeDefined();
    });
  });

  describe("a family's month", () => {
    it("refuses once the family's month is used up, whichever member asks, and says when it resets", async () => {
      repository.seedUsage(mum, 2 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(kid, 1 * USD, new Date("2026-10-06T10:00:00Z"));

      const error = await refusal(check(dad, 1));

      expect(error).toMatchObject({
        reason: "family_budget",
        limit: "family",
        limitMicros: 3 * USD,
        spentMicros: 3 * USD,
        resetsAt: NOVEMBER,
      });
      expect(error.message).toBe("This month's AI budget ($3.00) is used up. It starts again on 1 November.");
      await expect(check(kid, 1)).rejects.toMatchObject({ reason: "family_budget" });
    });

    it("allows the family again on the 1st, in Bucharest's time", async () => {
      repository.seedUsage(mum, 3 * USD, new Date("2026-10-30T10:00:00Z"));

      now = new Date("2026-10-31T21:59:59Z");
      await expect(check(mum, 1)).rejects.toMatchObject({ reason: "family_budget" });

      now = new Date("2026-10-31T22:00:00Z");
      await expect(check(mum, 1)).resolves.toMatchObject({ familySpentMicros: 0 });
      expect((await check(mum, 1)).month.key).toBe("2026-11");
    });

    it("refuses a call whose worst case doesn't fit what is left, and allows one that fits exactly", async () => {
      repository.seedUsage(mum, 2.5 * USD, new Date("2026-10-05T10:00:00Z"));

      const error = await refusal(check(mum, 0.6 * USD));
      expect(error.reason).toBe("family_budget");
      expect(error.message).toBe("This month's AI budget has $0.50 of $3.00 left, which isn't enough for this request. It starts again on 1 November.");

      await expect(check(mum, 0.5 * USD)).resolves.toBeDefined();
    });

    it("refuses a spent family even for a free estimate", async () => {
      repository.seedUsage(mum, 3 * USD, new Date("2026-10-05T10:00:00Z"));

      await expect(check(mum, 0)).rejects.toMatchObject({ reason: "family_budget" });
    });

    it("leaves another family alone", async () => {
      repository.seedUsage(mum, 3 * USD, new Date("2026-10-05T10:00:00Z"));

      await expect(check(outsider)).resolves.toBeDefined();
    });

    it("keeps a member who left in the family's month, and brings nothing from a member who joined", async () => {
      // A parent who left the family keeps their past spend in it.
      repository.seedUsage(dad, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.setUser(dad, { familyId: null });
      await expect(check(mum, 1)).rejects.toMatchObject({ reason: "family_budget" });
      // They start alone from zero.
      await expect(check(dad, 1)).resolves.toMatchObject({ familySpentMicros: 0 });

      // Someone who spent alone and then joins the family brings none of it.
      repository.seedUsage(otherSolo, 2 * USD, new Date("2026-10-06T10:00:00Z"));
      repository.setUser(otherSolo, { familyId: otherFamily, role: "parent" });
      await expect(check(outsider, 1)).resolves.toMatchObject({ familySpentMicros: 0 });
    });
  });

  describe("a user without a family", () => {
    it("is capped alone, with the same limit", async () => {
      repository.seedUsage(solo, 3 * USD, new Date("2026-10-05T10:00:00Z"));

      await expect(check(solo, 1)).rejects.toMatchObject({ reason: "family_budget", limit: "family", spentMicros: 3 * USD });
      // Neither another solo user nor a family is held back by it.
      await expect(check(otherSolo, 1)).resolves.toMatchObject({ familySpentMicros: 0 });
      await expect(check(mum, 1)).resolves.toMatchObject({ familySpentMicros: 0 });
    });
  });

  describe("the global backstop", () => {
    it("refuses everyone once all families together have used the month, though their own has room", async () => {
      repository.seedUsage(outsider, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(solo, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(otherSolo, 2.9 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(otherSolo, 1.1 * USD, new Date("2026-10-06T10:00:00Z"), { familyId: otherFamily });

      const error = await refusal(check(mum, 1));

      expect(error).toMatchObject({ reason: "global_budget", limit: "global", limitMicros: 10 * USD, spentMicros: 10 * USD, resetsAt: NOVEMBER });
      expect(error.message).toBe("The app's AI budget for this month ($10.00) is used up. It starts again on 1 November.");
    });

    it("refuses a call that would cross it", async () => {
      repository.seedUsage(outsider, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(solo, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(otherSolo, 3 * USD, new Date("2026-10-05T10:00:00Z"));

      await expect(check(mum, 1.5 * USD)).rejects.toMatchObject({ reason: "global_budget" });
      await expect(check(mum, 1 * USD)).resolves.toBeDefined();
    });

    it("counts only the current month", async () => {
      repository.seedUsage(outsider, 9 * USD, new Date("2026-09-20T10:00:00Z"));

      await expect(check(mum)).resolves.toMatchObject({ globalSpentMicros: 0 });
    });

    it("checks the family's limit before the global one", async () => {
      repository.seedUsage(mum, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(solo, 7 * USD, new Date("2026-10-05T10:00:00Z"));

      await expect(check(mum, 1)).rejects.toMatchObject({ reason: "family_budget" });
    });
  });

  it("takes the limits from the environment by default", async () => {
    vi.stubEnv("AI_FAMILY_MONTHLY_USD", "1");
    try {
      repository.seedUsage(mum, 1 * USD, new Date("2026-10-05T10:00:00Z"));
      await expect(check(mum, 1, { limits: undefined })).rejects.toMatchObject({ reason: "family_budget", limitMicros: 1 * USD });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses a nonsense request as a programming error, not a refusal", async () => {
    await expect(check("", 1)).rejects.toThrow(TypeError);
    await expect(check(mum, -1)).rejects.toThrow(TypeError);
    await expect(check(mum, 1.5)).rejects.toThrow(TypeError);
    await expect(checkBudget({ userId: mum, feature: "Statements", estimatedMicros: 1 }, dependencies())).rejects.toThrow(TypeError);
  });
});

describe("recordUsage", () => {
  it("writes the ledger row with the real tokens and cost, stamped with the user's family", async () => {
    await recordUsage(
      {
        userId: kid,
        feature: "statements",
        provider: "openai",
        model: "gpt-5.6-luna",
        outcome: "ok",
        inputTokens: 6000,
        outputTokens: 5000,
        cachedInputTokens: 4000,
        costMicros: 7200,
      },
      dependencies(),
    );

    expect(repository.usage).toEqual([
      {
        userId: kid,
        familyId: family,
        feature: "statements",
        provider: "openai",
        model: "gpt-5.6-luna",
        inputTokens: 6000,
        outputTokens: 5000,
        cachedInputTokens: 4000,
        costMicros: 7200,
        outcome: "ok",
        createdAt: MID_OCTOBER,
      },
    ]);
  });

  it("records a failed call even when the provider billed nothing", async () => {
    const result = await record(solo, 0, { outcome: "timeout" });

    expect(repository.usage).toMatchObject([{ userId: solo, familyId: null, outcome: "timeout", costMicros: 0, inputTokens: 0, outputTokens: 0 }]);
    // Nothing was spent, so the month isn't looked at.
    expect(result).toEqual({ familySpentMicros: null, globalSpentMicros: null, warned: null, switchedOff: false });
    expect(repository.calls).toEqual(["insertUsage"]);
  });

  it("records a failed call that the provider did bill, and counts it against the month", async () => {
    await record(mum, 2.9 * USD, { outcome: "max_tokens", inputTokens: 100_000, outputTokens: 400_000 });

    expect(repository.usage).toMatchObject([{ outcome: "max_tokens", costMicros: 2.9 * USD }]);
    await expect(check(mum, 0.2 * USD)).rejects.toMatchObject({ reason: "family_budget" });
  });

  it("throws when the ledger row can't be written, since the spend would go uncounted", async () => {
    repository.failing.add("insertUsage");

    await expect(record(mum, 1000)).rejects.toThrow("The fake insertUsage failed.");
  });

  it("refuses a nonsense record as a programming error", async () => {
    await expect(record(mum, -5)).rejects.toThrow(TypeError);
    await expect(record(mum, 1, { inputTokens: 0.5 })).rejects.toThrow(TypeError);
    await expect(record("", 1)).rejects.toThrow(TypeError);
    expect(repository.usage).toEqual([]);
  });

  describe("the family's 80% and 100% notifications", () => {
    it("tells the family's parents, and not the kid, when the month reaches 80%", async () => {
      await record(kid, 2.3 * USD);
      expect(repository.notifications).toEqual([]);

      const result = await record(kid, 0.1 * USD);

      expect(result).toMatchObject({ familySpentMicros: 2.4 * USD, warned: 80 });
      expect(repository.notifications.map((n) => n.userId).sort()).toEqual([dad, mum].sort());
      expect(repository.notifications[0]).toMatchObject({
        kind: "ai_budget",
        payload: { title: "AI budget at 80%", body: "Your family has used $2.40 of the $3.00 AI budget this month.", url: "/settings", tag: "ai-budget" },
      });
    });

    it("tells them once when the month is used up, with the date it resets", async () => {
      await record(mum, 2.5 * USD);
      const result = await record(kid, 0.5 * USD);

      expect(result.warned).toBe(100);
      const used = repository.notifications.filter((n) => n.payload.title === "AI budget used up");
      expect(used.map((n) => n.userId).sort()).toEqual([dad, mum].sort());
      expect(used[0].payload.body).toBe("Your family has used the $3.00 AI budget for this month. AI is paused until 1 November.");
    });

    it("queues a level once per month for each parent, however many later calls there are", async () => {
      await record(mum, 2.5 * USD);
      await record(mum, 0.05 * USD);
      await record(dad, 0.05 * USD);

      expect(repository.notifications).toHaveLength(2);

      // The next month warns again.
      now = new Date("2026-11-10T10:00:00Z");
      await record(mum, 2.5 * USD);
      expect(repository.notifications).toHaveLength(4);
    });

    it("sends the 80% warning and then the 100% one", async () => {
      await record(mum, 2.5 * USD);
      await record(mum, 0.5 * USD);

      expect(repository.notifications.map((n) => n.payload.title)).toEqual([
        "AI budget at 80%",
        "AI budget at 80%",
        "AI budget used up",
        "AI budget used up",
      ]);
    });

    it("sends only the 100% warning when one call jumps over 80%", async () => {
      await record(mum, 3.2 * USD);

      expect(repository.notifications.map((n) => n.payload.title)).toEqual(["AI budget used up", "AI budget used up"]);
    });

    it("sends nothing below 80%", async () => {
      await record(mum, 2.39 * USD);

      expect(repository.notifications).toEqual([]);
    });

    it("tells a user without a family alone", async () => {
      const result = await record(solo, 2.5 * USD);

      expect(result.warned).toBe(80);
      expect(repository.notifications).toMatchObject([
        { userId: solo, payload: { body: "You have used $2.50 of the $3.00 AI budget this month." } },
      ]);
    });

    it("counts a kid's calls against the family and still tells the parents", async () => {
      await record(kid, 3 * USD);

      expect(repository.notifications.map((n) => n.userId).sort()).toEqual([dad, mum].sort());
    });
  });

  describe("the global backstop", () => {
    it("turns the kill switch off and tells the admins when everyone's month reaches the budget", async () => {
      repository.seedUsage(outsider, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(solo, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(otherSolo, 3 * USD, new Date("2026-10-05T10:00:00Z"));
      expect(repository.enabled).toBe(true);

      const result = await record(mum, 1 * USD);

      expect(result).toMatchObject({ globalSpentMicros: 10 * USD, switchedOff: true });
      expect(repository.enabled).toBe(false);
      expect(repository.notifications.filter((n) => n.userId === admin)).toMatchObject([
        {
          kind: "ai_budget",
          dedupeKey: `ai_budget:global:2026-10:${admin}`,
          payload: { title: "AI turned off for everyone", body: "The $10.00 monthly AI budget was reached, so AI is off until you turn it back on." },
        },
      ]);
      // From now on every call is refused, whatever the user's own budget.
      await expect(check(mum, 1)).rejects.toMatchObject({ reason: "flag_off" });
    });

    it("leaves the switch on below the budget", async () => {
      repository.seedUsage(solo, 3 * USD, new Date("2026-10-05T10:00:00Z"));

      const result = await record(mum, 1 * USD);

      expect(result.switchedOff).toBe(false);
      expect(repository.enabled).toBe(true);
      expect(repository.notifications.filter((n) => n.userId === admin)).toEqual([]);
    });

    it("tells each admin once, and still turns the switch off when no admin is configured", async () => {
      repository.seedUsage(solo, 9 * USD, new Date("2026-10-05T10:00:00Z"));
      await recordUsage(
        { userId: mum, feature: "statements", provider: "fake", model: "fake-model", outcome: "ok", costMicros: 1 * USD },
        dependencies({ adminUserIds: [] }),
      );
      expect(repository.enabled).toBe(false);
      expect(repository.notifications.filter((n) => n.payload.tag === "ai-budget-global")).toEqual([]);

      // With admins, a second call over the budget (one that was already in flight) doesn't repeat the notice.
      repository.enabled = true;
      await record(mum, 0.1 * USD);
      repository.enabled = true;
      await record(mum, 0.1 * USD);
      expect(repository.notifications.filter((n) => n.userId === admin)).toHaveLength(1);
    });

    it("counts only the current month", async () => {
      repository.seedUsage(solo, 9.5 * USD, new Date("2026-09-20T10:00:00Z"));

      const result = await record(mum, 1 * USD);

      expect(result.switchedOff).toBe(false);
      expect(repository.enabled).toBe(true);
    });
  });

  describe("a follow-up that fails", () => {
    it("is logged, not thrown: the call is recorded and the next check refuses on the spend", async () => {
      repository.seedUsage(solo, 9 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.failing.add("setEnabled");

      await expect(record(mum, 1 * USD)).resolves.toMatchObject({ switchedOff: false });

      expect(repository.usage.at(-1)).toMatchObject({ userId: mum, costMicros: 1 * USD });
      expect(logged).toEqual(["AI gate: could not check the global budget after a call."]);
      await expect(check(mum, 1)).rejects.toMatchObject({ reason: "global_budget" });
    });

    it("does not stop the global check when the family's notification fails", async () => {
      repository.seedUsage(solo, 7 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.seedUsage(mum, 2.5 * USD, new Date("2026-10-05T10:00:00Z"));
      repository.failing.add("budgetRecipients");

      const result = await record(mum, 1 * USD);

      expect(logged).toEqual(["AI gate: could not check the family's budget after a call."]);
      expect(result.switchedOff).toBe(true);
    });

    it("does not stop the other admins being told when one notification fails", async () => {
      const second = "10000000-0000-4000-8000-0000000000ae";
      repository.seedUsage(solo, 9 * USD, new Date("2026-10-05T10:00:00Z"));
      const enqueue = repository.enqueueNotification.bind(repository);
      repository.enqueueNotification = async (notification) => {
        if (notification.userId === admin) throw new Error("outbox down");
        return enqueue(notification);
      };

      await recordUsage(
        { userId: mum, feature: "statements", provider: "fake", model: "fake-model", outcome: "ok", costMicros: 1 * USD },
        dependencies({ adminUserIds: [admin, second] }),
      );

      expect(repository.notifications.filter((n) => n.userId === second)).toHaveLength(1);
      expect(logged).toContain("AI gate: could not notify an admin.");
    });
  });
});

describe("a fake model through the gate", () => {
  it("refuses a family's fourth call of the month, and runs again on the 1st", async () => {
    const model = new FakeModel({ checkBudget, recordUsage });
    for (let i = 0; i < 3; i++) model.willSucceed({ inputTokens: 6000, outputTokens: 5000, costMicros: 1 * USD });

    for (const user of [mum, kid, dad]) {
      await expect(model.call({ userId: user, feature: "statements", estimatedMicros: 10_000 }, dependencies())).resolves.toEqual({ ok: true });
    }
    await expect(model.call({ userId: kid, feature: "statements", estimatedMicros: 10_000 }, dependencies())).rejects.toMatchObject({
      reason: "family_budget",
    });
    expect(model.calls).toHaveLength(3);
    expect(repository.usage.map((row) => row.costMicros)).toEqual([USD, USD, USD]);

    now = NOVEMBER;
    await expect(model.call({ userId: kid, feature: "statements", estimatedMicros: 10_000 }, dependencies())).resolves.toEqual({ ok: true });
    expect(model.calls).toHaveLength(4);
  });

  it("caps a user without a family alone", async () => {
    const model = new FakeModel({ checkBudget, recordUsage }).willSucceed({ costMicros: 3 * USD });

    await model.call({ userId: solo, feature: "statements", estimatedMicros: 1 }, dependencies());

    await expect(model.call({ userId: solo, feature: "statements", estimatedMicros: 1 }, dependencies())).rejects.toMatchObject({ reason: "family_budget" });
    await expect(model.call({ userId: otherSolo, feature: "statements", estimatedMicros: 1 }, dependencies())).resolves.toEqual({ ok: true });
  });

  it("turns the flag off when its calls take the global spend to the backstop", async () => {
    const model = new FakeModel({ checkBudget, recordUsage });
    const users = [mum, outsider, solo, otherSolo];
    // Four calls of $2.50 reach the $10 backstop exactly, each in a different family or alone.
    for (let i = 0; i < users.length; i++) model.willSucceed({ costMicros: 2.5 * USD });

    for (const user of users) await model.call({ userId: user, feature: "statements", estimatedMicros: 1 }, dependencies());

    expect(repository.enabled).toBe(false);
    await expect(model.call({ userId: mum, feature: "statements", estimatedMicros: 1 }, dependencies())).rejects.toMatchObject({ reason: "flag_off" });
  });

  it("records a failed call, billed or not, and returns the reason", async () => {
    const model = new FakeModel({ checkBudget, recordUsage })
      .willFail("rate_limited")
      .willFail("invalid_output", { inputTokens: 6000, outputTokens: 900, costMicros: 1200 })
      .willFail("refusal", { inputTokens: 6000, outputTokens: 20, costMicros: 1224 });

    const results = [];
    for (let i = 0; i < 3; i++) results.push(await model.call({ userId: mum, feature: "statements", estimatedMicros: 5000 }, dependencies()));

    expect(results).toEqual([
      { ok: false, reason: "rate_limited" },
      { ok: false, reason: "invalid_output" },
      { ok: false, reason: "refusal" },
    ]);
    expect(repository.usage.map((row) => [row.outcome, row.inputTokens, row.outputTokens, row.costMicros])).toEqual([
      ["rate_limited", 0, 0, 0],
      ["invalid_output", 6000, 900, 1200],
      ["refusal", 6000, 20, 1224],
    ]);
  });

  it("makes no call and records nothing when the gate refuses", async () => {
    repository.setUser(solo, { optedIn: false });
    const model = new FakeModel({ checkBudget, recordUsage });

    await expect(model.call({ userId: solo, feature: "statements", estimatedMicros: 1 }, dependencies())).rejects.toBeInstanceOf(AiGateError);

    expect(model.calls).toEqual([]);
    expect(repository.usage).toEqual([]);
  });
});

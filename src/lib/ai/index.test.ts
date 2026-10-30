import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { AI_FEATURES, estimateInputTokens, structured, type StructuredDependencies, type StructuredInput } from "@/lib/ai";
import type { AiGateDependencies } from "@/lib/ai/gate";
import type { PricingTable } from "@/lib/ai/pricing";
import { FakeProvider } from "@/lib/ai/providers/fake";
import { FakeAiGateRepository } from "@/test/fakes/ai";

const mum = "10000000-0000-4000-8000-000000000151";
const dad = "10000000-0000-4000-8000-000000000152";
const kid = "10000000-0000-4000-8000-000000000153";
const solo = "10000000-0000-4000-8000-000000000154";
const otherSolo = "10000000-0000-4000-8000-000000000155";
const outsider = "10000000-0000-4000-8000-000000000156";
const family = "20000000-0000-4000-8000-000000000151";
const otherFamily = "20000000-0000-4000-8000-000000000152";
const admin = "10000000-0000-4000-8000-0000000000ad";

const USD = 1_000_000;
// Bucharest is UTC+3 until 25 October 2026 and UTC+2 after.
const MID_OCTOBER = new Date("2026-10-15T10:00:00Z");
const NOVEMBER = new Date("2026-10-31T22:00:00Z");
const LIMITS = { familyMonthlyMicros: 3 * USD, globalMonthlyMicros: 10 * USD };

// A test price that makes sums easy to read: a micro per input token, a tenth of one per cached
// token, ten per output token ($10 per million).
const PRICING: PricingTable = {
  fake: {
    "fake-model": { inputPerMillionMicros: 1_000_000, cachedInputPerMillionMicros: 100_000, outputPerMillionMicros: 10_000_000, standardInputTokens: 50_000 },
  },
};
const ENV = { AI_MODEL_STATEMENTS: "fake-model" };

const schema = z.object({ k: z.array(z.object({ c: z.string() })) });
const answer = { k: [{ c: "food" }] };

let repository: FakeAiGateRepository;
let provider: FakeProvider;
let now: Date;
let logged: Record<string, unknown>[];

function gate(): AiGateDependencies {
  return { repository, limits: LIMITS, now: () => now, adminUserIds: [admin], log: () => undefined };
}

function dependencies(overrides: Partial<StructuredDependencies> = {}): StructuredDependencies {
  return { provider, pricing: PRICING, env: ENV, gate: gate(), log: (line) => logged.push(line), ...overrides };
}

function input(overrides: Partial<StructuredInput<z.infer<typeof schema>>> = {}): StructuredInput<z.infer<typeof schema>> {
  return {
    feature: "statements",
    userId: mum,
    system: "Fixed instructions.",
    input: "0001\tLIDL 12.50",
    schema,
    schemaName: "merchant_categories",
    maxOutputTokens: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  now = MID_OCTOBER;
  logged = [];
  provider = new FakeProvider();
  provider.inputTokenCount = 1000;
  repository = new FakeAiGateRepository();
  repository.now = () => now;
  repository.setUser(mum, { familyId: family, role: "parent", optedIn: true });
  repository.setUser(dad, { familyId: family, role: "parent", optedIn: true });
  repository.setUser(kid, { familyId: family, role: "kid", optedIn: true, kidAiPermission: true });
  repository.setUser(solo, { optedIn: true });
  repository.setUser(otherSolo, { optedIn: true });
  repository.setUser(outsider, { familyId: otherFamily, role: "parent", optedIn: true });
});

describe("structured", () => {
  it("records a call with its exact tokens and cost", async () => {
    provider.willReturn(answer, { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 400 });

    const result = await structured(input(), dependencies());

    // 600 fresh input tokens at 1 micro, 400 cached at 0.1, 200 output at 10.
    expect(result).toEqual({
      ok: true,
      value: answer,
      usage: { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 400 },
      provider: "fake",
      model: "fake-model",
      costMicros: 600 + 40 + 2000,
    });
    expect(repository.usage).toHaveLength(1);
    expect(repository.usage[0]).toMatchObject({
      userId: mum,
      familyId: family,
      feature: "statements",
      provider: "fake",
      model: "fake-model",
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 400,
      costMicros: 2640,
      outcome: "ok",
    });
    expect(logged).toEqual([
      { feature: "statements", provider: "fake", model: "fake-model", outcome: "ok", inputTokens: 1000, outputTokens: 200, cachedInputTokens: 400, costMicros: 2640 },
    ]);
  });

  it("rounds a cost up to a whole micro, so a call is never recorded as free", async () => {
    provider.willReturn(answer, { inputTokens: 1, outputTokens: 0, cachedInputTokens: 1 });

    const result = await structured(input(), dependencies());

    expect(result).toMatchObject({ ok: true, costMicros: 1 });
  });

  it("passes the request to the provider with the model from the feature's env value", async () => {
    provider.willReturn(answer);
    const controller = new AbortController();

    await structured(input({ effort: "none", timeoutMs: 5000, signal: controller.signal }), dependencies());

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      model: "fake-model",
      system: "Fixed instructions.",
      input: "0001\tLIDL 12.50",
      schemaName: "merchant_categories",
      maxOutputTokens: 1000,
      effort: "none",
      timeoutMs: 5000,
      signal: controller.signal,
    });
  });

  describe("when the provider can't count, estimates conservatively", () => {
    const text = "x".repeat(300);
    const schemaJson = JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }));
    // The worst case: the estimate at a micro a token plus 1000 output tokens at ten.
    const worstCase = estimateInputTokens(["Fixed instructions.", text, schemaJson]) + 10_000;

    it("rounds three characters to a token up", () => {
      expect(estimateInputTokens(["aaaaaaa"])).toBe(3);
      expect(estimateInputTokens(["aaa", "bbb"])).toBe(2);
      expect(estimateInputTokens([])).toBe(0);
    });

    it("prices the system text, the input and the schema, and lets a call that exactly fits through", async () => {
      provider.inputTokenCount = null;
      provider.willReturn(answer);
      repository.seedUsage(dad, 3 * USD - worstCase, MID_OCTOBER);

      expect((await structured(input({ input: text }), dependencies())).ok).toBe(true);
    });

    it("refuses a call a micro over", async () => {
      provider.inputTokenCount = null;
      repository.seedUsage(dad, 3 * USD - worstCase + 1, MID_OCTOBER);

      expect(await structured(input({ input: text }), dependencies())).toMatchObject({ called: false, reason: "family_budget" });
      expect(provider.requests).toEqual([]);
    });
  });

  describe("refuses, without calling the provider or recording anything", () => {
    afterEach(() => {
      expect(provider.requests).toEqual([]);
      expect(repository.calls).not.toContain("insertUsage");
    });

    it("over the feature's input cap, by the provider's count", async () => {
      provider.inputTokenCount = AI_FEATURES.statements.maxInputTokens + 1;
      const result = await structured(input(), dependencies({ pricing: { fake: { "fake-model": { ...PRICING.fake["fake-model"], standardInputTokens: 1_000_000 } } } }));
      expect(result).toMatchObject({ ok: false, called: false, reason: "input_too_large" });
    });

    it("over the feature's input cap, by the estimate", async () => {
      provider.inputTokenCount = null;
      const result = await structured(
        input({ input: "x".repeat(AI_FEATURES.statements.maxInputTokens * 3 + 1) }),
        dependencies({ pricing: { fake: { "fake-model": { ...PRICING.fake["fake-model"], standardInputTokens: 1_000_000 } } } }),
      );
      expect(result).toMatchObject({ ok: false, called: false, reason: "input_too_large" });
    });

    it("over what the model's standard prices cover", async () => {
      provider.inputTokenCount = 50_001;
      expect(await structured(input(), dependencies())).toMatchObject({ ok: false, called: false, reason: "input_too_large" });
    });

    it("over the feature's output cap", async () => {
      const result = await structured(input({ maxOutputTokens: AI_FEATURES.statements.maxOutputTokens + 1 }), dependencies());
      expect(result).toMatchObject({ ok: false, called: false, reason: "output_too_large" });
    });

    it("for a model that isn't in the pricing table, rather than pricing it at zero", async () => {
      const result = await structured(input(), dependencies({ env: { AI_MODEL_STATEMENTS: "some-new-model" } }));
      expect(result).toMatchObject({ ok: false, called: false, reason: "unknown_model" });
    });

    it("for a provider that isn't in the pricing table", async () => {
      const result = await structured(input(), dependencies({ pricing: { openai: PRICING.fake } }));
      expect(result).toMatchObject({ ok: false, called: false, reason: "unknown_model" });
    });

    it("when the feature has no model in the environment", async () => {
      expect(await structured(input(), dependencies({ env: {} }))).toMatchObject({ ok: false, called: false, reason: "not_configured" });
    });

    it("when no provider is chosen, or it has no key", async () => {
      const without = dependencies({ provider: undefined, env: ENV });
      expect(await structured(input(), without)).toMatchObject({ ok: false, called: false, reason: "not_configured" });
      expect(await structured(input(), { ...without, env: { ...ENV, AI_PROVIDER: "openai" } })).toMatchObject({ reason: "not_configured" });
      expect(await structured(input(), { ...without, env: { ...ENV, AI_PROVIDER: "mystery", OPENAI_API_KEY: "sk-test" } })).toMatchObject({ reason: "not_configured" });
    });

    it("when the user hasn't opted in", async () => {
      repository.setUser(solo, { optedIn: false });
      const result = await structured(input({ userId: solo }), dependencies());
      expect(result).toMatchObject({ ok: false, called: false, reason: "not_opted_in" });
    });

    it("when the kill switch is off", async () => {
      repository.enabled = false;
      expect(await structured(input(), dependencies())).toMatchObject({ ok: false, called: false, reason: "flag_off" });
    });

    it("when the worst case doesn't fit what is left of the family's month, with the gate's words", async () => {
      // 1000 input tokens and 1000 output tokens at ten micros: a worst case of 11,000 micros.
      repository.seedUsage(dad, 3 * USD - 10_999, MID_OCTOBER);
      const result = await structured(input(), dependencies());
      expect(result).toMatchObject({ ok: false, called: false, reason: "family_budget", message: expect.stringContaining("isn't enough") });
      expect(result.ok === false && "gate" in result ? result.gate?.limit : null).toBe("family");
    });
  });

  it("lets the same call through when its worst case just fits", async () => {
    repository.seedUsage(dad, 3 * USD - 11_000, MID_OCTOBER);
    provider.willReturn(answer);

    expect((await structured(input(), dependencies())).ok).toBe(true);
  });

  it("refuses a family once its month is used up, and runs again on the 1st", async () => {
    // Three calls of exactly $1 each: 100,000 output tokens at $10 per million.
    for (let i = 0; i < 3; i++) provider.willReturn(answer, { inputTokens: 0, outputTokens: 100_000, cachedInputTokens: 0 });

    for (const userId of [mum, kid, dad]) expect((await structured(input({ userId }), dependencies())).ok).toBe(true);
    const fourth = await structured(input({ userId: kid }), dependencies());
    expect(fourth).toMatchObject({ ok: false, called: false, reason: "family_budget" });
    expect(provider.requests).toHaveLength(3);
    expect(repository.usage.map((row) => row.costMicros)).toEqual([USD, USD, USD]);

    now = NOVEMBER;
    provider.willReturn(answer);
    expect((await structured(input({ userId: kid }), dependencies())).ok).toBe(true);
  });

  it("caps a user without a family alone", async () => {
    provider.willReturn(answer, { inputTokens: 0, outputTokens: 300_000, cachedInputTokens: 0 });
    await structured(input({ userId: solo }), dependencies());

    expect(await structured(input({ userId: solo }), dependencies())).toMatchObject({ called: false, reason: "family_budget" });
    provider.willReturn(answer);
    expect((await structured(input({ userId: otherSolo }), dependencies())).ok).toBe(true);
  });

  it("turns the flag off when its calls take the global spend to the backstop", async () => {
    const users = [mum, outsider, solo, otherSolo];
    // Four calls of $2.50 reach the $10 backstop exactly, each in a different family or alone.
    for (let i = 0; i < users.length; i++) provider.willReturn(answer, { inputTokens: 0, outputTokens: 250_000, cachedInputTokens: 0 });

    for (const userId of users) await structured(input({ userId }), dependencies());

    expect(repository.enabled).toBe(false);
    expect(await structured(input(), dependencies())).toMatchObject({ called: false, reason: "flag_off" });
  });

  it("records a failed call, billed or not, and returns the reason", async () => {
    provider
      .willFail("rate_limited", null, "openai 429 rate_limit_exceeded")
      .willFail("invalid_output", { inputTokens: 600, outputTokens: 90, cachedInputTokens: 0 })
      .willFail("refusal", { inputTokens: 600, outputTokens: 2, cachedInputTokens: 100 })
      .willFail("max_tokens", { inputTokens: 600, outputTokens: 1000, cachedInputTokens: 0 });

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await structured(input(), dependencies()));

    expect(results).toEqual([
      { ok: false, called: true, reason: "rate_limited", detail: "openai 429 rate_limit_exceeded", provider: "fake", model: "fake-model", usage: null, costMicros: 0 },
      { ok: false, called: true, reason: "invalid_output", provider: "fake", model: "fake-model", usage: { inputTokens: 600, outputTokens: 90, cachedInputTokens: 0 }, costMicros: 1500 },
      { ok: false, called: true, reason: "refusal", provider: "fake", model: "fake-model", usage: { inputTokens: 600, outputTokens: 2, cachedInputTokens: 100 }, costMicros: 530 },
      { ok: false, called: true, reason: "max_tokens", provider: "fake", model: "fake-model", usage: { inputTokens: 600, outputTokens: 1000, cachedInputTokens: 0 }, costMicros: 10_600 },
    ]);
    expect(repository.usage.map((row) => [row.outcome, row.inputTokens, row.outputTokens, row.costMicros])).toEqual([
      ["rate_limited", 0, 0, 0],
      ["invalid_output", 600, 90, 1500],
      ["refusal", 600, 2, 530],
      ["max_tokens", 600, 1000, 10_600],
    ]);
    expect(logged[0]).toMatchObject({ outcome: "rate_limited", detail: "openai 429 rate_limit_exceeded" });
  });

  it("returns a value the schema rejects as invalid_output and still records its tokens", async () => {
    provider.willReturn({ k: "not a list" }, { inputTokens: 600, outputTokens: 40, cachedInputTokens: 0 });

    const result = await structured(input(), dependencies());

    expect(result).toMatchObject({ ok: false, called: true, reason: "invalid_output" });
    expect(repository.usage.map((row) => [row.outcome, row.costMicros])).toEqual([["invalid_output", 1000]]);
  });

  it("throws, rather than returns, when the ledger row can't be written", async () => {
    provider.willReturn(answer);
    repository.failing.add("insertUsage");

    await expect(structured(input(), dependencies())).rejects.toThrow("insertUsage");
  });

  it("throws for programming errors", async () => {
    await expect(structured(input({ feature: "nope" as "statements" }), dependencies())).rejects.toThrow(TypeError);
    await expect(structured(input({ userId: "" }), dependencies())).rejects.toThrow(TypeError);
    await expect(structured(input({ schemaName: "has spaces" }), dependencies())).rejects.toThrow(TypeError);
    await expect(structured(input({ maxOutputTokens: 0 }), dependencies())).rejects.toThrow(TypeError);
    expect(provider.requests).toEqual([]);
  });

  it("keeps the features' caps inside what the production model's prices cover", async () => {
    const { PRICING: production } = await import("@/lib/ai/pricing");
    for (const price of Object.values(production.openai)) {
      for (const feature of Object.values(AI_FEATURES)) expect(feature.maxInputTokens).toBeLessThanOrEqual(price.standardInputTokens);
    }
  });
});

import { describe, expect, it } from "vitest";

import { findPrice, PRICING, usageCostMicros, worstCaseMicros } from "@/lib/ai/pricing";

const luna = PRICING.openai["gpt-5.6-luna"];

describe("PRICING", () => {
  it("holds gpt-5.6-luna at OpenAI's standard prices of 30 October 2026: $0.20, $0.02 and $1.20 per million", () => {
    expect(luna).toEqual({
      inputPerMillionMicros: 200_000,
      cachedInputPerMillionMicros: 20_000,
      outputPerMillionMicros: 1_200_000,
      standardInputTokens: 272_000,
    });
  });

  it("holds every OpenAI model at its standard prices of 30 October 2026, exact in micros", () => {
    const perMillion = Object.fromEntries(
      Object.entries(PRICING.openai).map(([model, price]) => [
        model,
        [price.inputPerMillionMicros, price.cachedInputPerMillionMicros, price.outputPerMillionMicros, price.standardInputTokens],
      ]),
    );
    expect(perMillion).toEqual({
      "gpt-6.1-terra": [1_000_000, 50_000, 5_000_000, 272_000],
      "gpt-6-sol": [2_000_000, 200_000, 10_000_000, 272_000],
      "gpt-6-luna": [100_000, 10_000, 500_000, 272_000],
      "gpt-5.6-sol": [4_000_000, 400_000, 20_000_000, 272_000],
      "gpt-5.6-terra": [2_000_000, 200_000, 12_000_000, 272_000],
      "gpt-5.6-luna": [200_000, 20_000, 1_200_000, 272_000],
    });
  });

  it("leaves out the models that reject reasoning effort none", () => {
    expect(findPrice("openai", "gpt-6-astra")).toBeNull();
    expect(findPrice("openai", "gpt-6.1-sol")).toBeNull();
  });
});

describe("findPrice", () => {
  it("finds a known provider and model", () => {
    expect(findPrice("openai", "gpt-5.6-luna")).toBe(luna);
  });

  it("is null, never zero, for an unknown model, provider or inherited property name", () => {
    expect(findPrice("openai", "gpt-5.6-luna-2026-10-30")).toBeNull();
    expect(findPrice("openai", "gpt-9")).toBeNull();
    expect(findPrice("anthropic", "gpt-5.6-luna")).toBeNull();
    expect(findPrice("fake", "fake-model")).toBeNull();
    expect(findPrice("openai", "constructor")).toBeNull();
    expect(findPrice("toString", "gpt-5.6-luna")).toBeNull();
  });

  it("reads from a table it is given", () => {
    const table = { other: { m: luna } };
    expect(findPrice("other", "m", table)).toBe(luna);
    expect(findPrice("openai", "gpt-5.6-luna", table)).toBeNull();
  });
});

describe("usageCostMicros", () => {
  it("prices fresh input, cached input and output separately", () => {
    // 6000 fresh at $0.20/M = 1200 micros, 1000 cached at $0.02/M = 20, 5000 output at $1.20/M = 6000.
    expect(usageCostMicros(luna, { inputTokens: 7000, cachedInputTokens: 1000, outputTokens: 5000 })).toBe(7220);
  });

  it("prices the plan's 150-transaction statement at about a cent", () => {
    // About 6,000 input tokens and 5,000 output tokens: $0.0012 + $0.006.
    expect(usageCostMicros(luna, { inputTokens: 6000, cachedInputTokens: 0, outputTokens: 5000 })).toBe(7200);
  });

  it("rounds up to a whole micro, so a call that cost anything isn't free", () => {
    expect(usageCostMicros(luna, { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 })).toBe(1);
    expect(usageCostMicros(luna, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("treats cached tokens beyond the input as all of it", () => {
    expect(usageCostMicros(luna, { inputTokens: 1000, cachedInputTokens: 5000, outputTokens: 0 })).toBe(20);
  });
});

describe("worstCaseMicros", () => {
  it("is all the input uncached plus the whole output cap", () => {
    expect(worstCaseMicros(luna, 6000, 5000)).toBe(7200);
    expect(worstCaseMicros(luna, 120_000, 32_000)).toBe(24_000 + 38_400);
  });
});

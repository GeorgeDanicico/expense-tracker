import { describe, expect, it } from "vitest";

import {
  HEADROOM,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  categoriseOutputCap,
  readerOutputCap,
} from "@/lib/imports/ai/output-cap";

describe("categoriseOutputCap", () => {
  it("grows with the merchants: ten tokens each, with headroom", () => {
    expect(categoriseOutputCap(50)).toBe(Math.ceil((50 + 10 * 50) * HEADROOM));
    expect(categoriseOutputCap(100)).toBeGreaterThan(categoriseOutputCap(50));
  });

  it("is never under the floor, and never over what the feature may ask for", () => {
    expect(categoriseOutputCap(0)).toBe(MIN_OUTPUT_TOKENS);
    expect(categoriseOutputCap(1)).toBe(MIN_OUTPUT_TOKENS);
    expect(categoriseOutputCap(100_000)).toBe(MAX_OUTPUT_TOKENS);
  });
});

describe("readerOutputCap", () => {
  it("is about 35 tokens a transaction line plus 10 a possible merchant, with headroom", () => {
    expect(readerOutputCap({ lineCount: 160, transactionLines: 150 })).toBe(Math.ceil((100 + 45 * 150) * HEADROOM));
  });

  it("covers the answers the plan expects (about 30 tokens a row and 8 a merchant) twice over", () => {
    const expected = 150 * 30 + 150 * 8;
    expect(readerOutputCap({ lineCount: 160, transactionLines: 150 })).toBeGreaterThan(expected * 1.5);
  });

  it("sizes a layout whose dates and amounts are on different lines by the statement's length", () => {
    expect(readerOutputCap({ lineCount: 400, transactionLines: 0 })).toBe(Math.ceil((100 + 45 * 100) * HEADROOM));
  });

  it("is capped at the feature's maximum, which 500 transactions already reach", () => {
    expect(readerOutputCap({ lineCount: 3000, transactionLines: 500 })).toBe(MAX_OUTPUT_TOKENS);
    expect(readerOutputCap({ lineCount: 10, transactionLines: 1 })).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
  });
});

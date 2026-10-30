import type { AiUsage } from "@/lib/ai/provider";

/**
 * What a model call costs (docs/statement-import-plan.md, I15). Every call is priced from this table
 * and the price is what the gate checks and the ledger records. A provider or model that isn't here
 * is refused by `structured`, never priced at zero.
 *
 * Money is in micros, millionths of a dollar, so a price is "micros per million tokens", which is
 * the dollar price per million tokens times 1,000,000.
 */
export type ModelPrice = {
  /** Input tokens not served from the provider's cache. */
  inputPerMillionMicros: number;
  /** Input tokens served from the provider's cache. */
  cachedInputPerMillionMicros: number;
  outputPerMillionMicros: number;
  /**
   * The most input tokens these prices cover. A longer request is billed at higher rates that this
   * table doesn't hold, so `structured` refuses it rather than under-pricing it.
   */
  standardInputTokens: number;
};

export type PricingTable = Record<string, Record<string, ModelPrice>>;

/** A row of the table from dollars per million tokens, as the pricing page prints them. */
function price(usd: { input: number; cachedInput: number; output: number }): ModelPrice {
  return {
    inputPerMillionMicros: Math.round(usd.input * 1_000_000),
    cachedInputPerMillionMicros: Math.round(usd.cachedInput * 1_000_000),
    outputPerMillionMicros: Math.round(usd.output * 1_000_000),
    standardInputTokens: 272_000,
  };
}

/**
 * Copied from OpenAI's pricing page (developers.openai.com/api/docs/pricing) and each model's page
 * (developers.openai.com/api/docs/models/<model>) on 30 October 2026, standard processing tier, in
 * dollars per million tokens:
 *
 *   model           input  cached  output
 *   gpt-6.1-terra    1.00    0.05    5.00
 *   gpt-6-sol        2.00    0.20   10.00
 *   gpt-6-luna       0.10    0.01    0.50
 *   gpt-5.6-sol      4.00    0.40   20.00
 *   gpt-5.6-terra    2.00    0.20   12.00
 *   gpt-5.6-luna     0.20    0.02    1.20
 *
 * Requests over 272K input tokens are billed at higher rates, hence `standardInputTokens`.
 * Reasoning tokens count as output.
 *
 * Only models that support Structured Outputs on the Responses API and accept `reasoning.effort:
 * "none"`, which the statement reader sends, are listed. `gpt-6-astra` and `gpt-6.1-sol` reject
 * "none" with a 400, so they are left out until a feature asks for more effort.
 *
 * Not modelled: these models bill tokens written to the prompt cache at 1.25x the input rate instead
 * of 1x (the usage's `cache_write_tokens`, which the provider interface has no field for). Those
 * tokens are priced here as ordinary input, so a call's recorded cost can be a quarter of the input
 * rate low on its cache-written tokens, a few hundredths of a cent for a statement on a Luna model.
 * OpenAI's own usage page is the reference when the two differ.
 */
export const PRICING: PricingTable = {
  openai: {
    "gpt-6.1-terra": price({ input: 1, cachedInput: 0.05, output: 5 }),
    "gpt-6-sol": price({ input: 2, cachedInput: 0.2, output: 10 }),
    "gpt-6-luna": price({ input: 0.1, cachedInput: 0.01, output: 0.5 }),
    "gpt-5.6-sol": price({ input: 4, cachedInput: 0.4, output: 20 }),
    "gpt-5.6-terra": price({ input: 2, cachedInput: 0.2, output: 12 }),
    "gpt-5.6-luna": price({ input: 0.2, cachedInput: 0.02, output: 1.2 }),
  },
};

/** The price of `model` at `provider`, or null when the table doesn't have it. Exact names only. */
export function findPrice(provider: string, model: string, table: PricingTable = PRICING): ModelPrice | null {
  if (!Object.hasOwn(table, provider)) return null;
  const models = table[provider];
  return Object.hasOwn(models, model) ? models[model] : null;
}

/**
 * The real cost of a finished call in micros, rounded up so a call that cost anything is never
 * recorded as free. `cachedInputTokens` is part of `inputTokens` and is billed at the cached rate;
 * a count above `inputTokens` is treated as all of it.
 */
export function usageCostMicros(price: ModelPrice, usage: AiUsage): number {
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  const total = fresh * price.inputPerMillionMicros + cached * price.cachedInputPerMillionMicros + usage.outputTokens * price.outputPerMillionMicros;
  return Math.ceil(total / 1_000_000);
}

/** What a call could cost at most: all its input uncached plus its whole output cap, in micros. */
export function worstCaseMicros(price: ModelPrice, inputTokens: number, maxOutputTokens: number): number {
  return Math.ceil((inputTokens * price.inputPerMillionMicros + maxOutputTokens * price.outputPerMillionMicros) / 1_000_000);
}

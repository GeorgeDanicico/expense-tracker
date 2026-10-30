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

/**
 * Copied from OpenAI's model page (developers.openai.com/api/docs/models/gpt-5.6-luna) and pricing
 * page (developers.openai.com/api/docs/pricing) on 30 October 2026, standard processing tier:
 * $0.20 input, $0.02 cached input, $1.20 output, each per million tokens. Requests over 272K input
 * tokens are billed at higher rates, hence `standardInputTokens`. Reasoning tokens count as output.
 *
 * Not modelled: GPT-5.6 bills tokens it writes to its prompt cache at 1.25x the input rate instead
 * of 1x (the usage's `cache_write_tokens`, which the provider interface has no field for). Those
 * tokens are priced here as ordinary input, so a call's recorded cost can be up to $0.05 per million
 * cache-written tokens low, a few hundredths of a cent for a statement. OpenAI's own usage page is
 * the reference when the two differ.
 */
export const PRICING: PricingTable = {
  openai: {
    "gpt-5.6-luna": {
      inputPerMillionMicros: 200_000,
      cachedInputPerMillionMicros: 20_000,
      outputPerMillionMicros: 1_200_000,
      standardInputTokens: 272_000,
    },
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

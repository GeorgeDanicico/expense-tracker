import "server-only";

import { z } from "zod";

import { checkBudget, recordUsage, AiGateError, type AiGateDependencies, type AiGateReason } from "@/lib/ai/gate";
import { findPrice, usageCostMicros, worstCaseMicros, PRICING, type PricingTable } from "@/lib/ai/pricing";
import type { AiProvider, AiProviderId, AiUsage, StructuredRequest, StructuredResult } from "@/lib/ai/provider";

/**
 * The only entry point features use to call a model (docs/statement-import-plan.md, I15; roadmap
 * 8.2). A feature names itself, the user and what to ask; this picks the provider and model from the
 * environment, refuses what is too big or unpriced, passes the gate (`checkBudget` with the worst
 * case the call could cost), calls the provider, and records the real tokens and cost in the ledger
 * whether the call worked or not. A feature never imports a provider's SDK.
 *
 * It returns, it doesn't throw, for everything expected: a refusal before the call and every way a
 * call can fail. It throws for programming errors (a feature or schema name that isn't valid), and
 * when the ledger row can't be written, since the spend would otherwise go uncounted.
 */

/** What a feature may ask for. A new feature is a row here plus its model in the environment. */
export type AiFeatureConfig = {
  /** The environment variable naming the feature's model. */
  modelEnv: string;
  /** The longest input, in tokens, the feature may send. */
  maxInputTokens: number;
  /** The most output, in tokens, the feature may ask for. */
  maxOutputTokens: number;
};

export const AI_FEATURES = {
  // 500 transactions is I4's limit: about 35 output tokens a line plus a category per merchant is
  // under 25,000, and a long statement's text is far under 120,000 tokens of input.
  statements: { modelEnv: "AI_MODEL_STATEMENTS", maxInputTokens: 120_000, maxOutputTokens: 32_000 },
} as const satisfies Record<string, AiFeatureConfig>;

export type AiFeature = keyof typeof AI_FEATURES;

/** How long a call may take, retries included, when the feature doesn't say. */
export const DEFAULT_TIMEOUT_MS = 90_000;

export type StructuredInput<T> = {
  feature: AiFeature;
  /** The signed-in caller: the gate reads their opt-in and their family's spend as them. */
  userId: string;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
  effort?: StructuredRequest<T>["effort"];
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Why a call was refused before it was made: a gate reason or one of these. */
export type AiRefusalReason =
  | AiGateReason
  /** No provider, key or model is set up for the feature. */
  | "not_configured"
  /** The provider or model isn't in the pricing table, so the call can't be priced. */
  | "unknown_model"
  /** The input is over the feature's cap, or over what the model's standard prices cover. */
  | "input_too_large"
  /** The call asked for more output than the feature allows. */
  | "output_too_large";

/** What was spent, for the caller to show or test; the ledger row holds the same numbers. */
export type AiCall = {
  provider: AiProviderId;
  model: string;
  usage: AiUsage | null;
  costMicros: number;
};

export type StructuredOutcome<T> =
  | ({ ok: true; value: T; usage: AiUsage } & AiCall)
  | ({
      ok: false;
      /** The provider was called: it failed, and its cost (if any) is recorded. */
      called: true;
      reason: Extract<StructuredResult<T>, { ok: false }>["reason"];
      detail?: string;
    } & AiCall)
  | {
      ok: false;
      /** Nothing was sent and nothing is recorded. */
      called: false;
      reason: AiRefusalReason;
      /** Words for the user: the gate's, with the limit and the day it resets, or a plain sentence. */
      message: string;
      /** The gate's refusal, with the limit and when the budget starts again, for a gate reason. */
      gate?: AiGateError;
    };

export type StructuredDependencies = {
  /** Replaces the provider chosen by `AI_PROVIDER`; tests pass a `FakeProvider`. */
  provider?: AiProvider;
  pricing?: PricingTable;
  env?: Record<string, string | undefined>;
  gate?: AiGateDependencies;
  /** One line per call: feature, provider, model, tokens, cost and outcome. Never a prompt or an answer. */
  log?: (line: Record<string, unknown>) => void;
};

const SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * An upper bound on the input tokens of a call that a provider can't count: three characters to the
 * token, rounded up, over the prompt and the JSON Schema the provider is given.
 */
export function estimateInputTokens(parts: readonly string[]) {
  return Math.ceil(parts.reduce((sum, part) => sum + part.length, 0) / 3);
}

async function loadProvider(env: Record<string, string | undefined>): Promise<AiProvider | null> {
  const id = env.AI_PROVIDER?.trim();
  if (id === "openai") {
    if (!env.OPENAI_API_KEY?.trim()) return null;
    // Loaded here, not at the top, so the SDK is only read by a request that makes a call.
    const { createOpenAiProvider } = await import("@/lib/ai/providers/openai");
    return createOpenAiProvider({ apiKey: env.OPENAI_API_KEY.trim() });
  }
  return null;
}

function refused(reason: AiRefusalReason, message: string, gate?: AiGateError): StructuredOutcome<never> {
  return { ok: false, called: false, reason, message, ...(gate ? { gate } : {}) };
}

export async function structured<T>(request: StructuredInput<T>, dependencies: StructuredDependencies = {}): Promise<StructuredOutcome<T>> {
  const feature = Object.hasOwn(AI_FEATURES, request.feature) ? AI_FEATURES[request.feature] : null;
  if (!feature) throw new TypeError("That AI feature isn't defined.");
  if (!request.userId) throw new TypeError("An AI call needs a user.");
  if (!SCHEMA_NAME.test(request.schemaName)) throw new TypeError("A schema name is letters, digits, dashes and underscores, 64 at most.");
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) throw new TypeError("maxOutputTokens must be a positive whole number.");

  const env = dependencies.env ?? process.env;
  const log = dependencies.log ?? ((line) => console.info("AI call", line));

  if (request.maxOutputTokens > feature.maxOutputTokens) {
    return refused("output_too_large", "This request asks the model for more than it may write.");
  }

  const provider = dependencies.provider ?? (await loadProvider(env));
  const model = env[feature.modelEnv]?.trim();
  if (!provider || !model) return refused("not_configured", "AI isn't set up on this server.");
  const price = findPrice(provider.id, model, dependencies.pricing ?? PRICING);
  if (!price) return refused("unknown_model", "The AI model for this feature has no price on file, so it can't be used.");

  const providerRequest: StructuredRequest<T> = {
    model,
    system: request.system,
    input: request.input,
    schema: request.schema,
    schemaName: request.schemaName,
    maxOutputTokens: request.maxOutputTokens,
    effort: request.effort,
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: request.signal,
  };

  const counted = await provider.countInputTokens(providerRequest);
  const inputTokens = counted ?? estimateInputTokens([request.system, request.input, JSON.stringify(z.toJSONSchema(request.schema, { io: "input", unrepresentable: "any" }))]);
  if (inputTokens > feature.maxInputTokens || inputTokens > price.standardInputTokens) {
    return refused("input_too_large", "This is too long for the AI to read in one go.");
  }

  try {
    await checkBudget(
      { userId: request.userId, feature: request.feature, estimatedMicros: worstCaseMicros(price, inputTokens, request.maxOutputTokens) },
      dependencies.gate,
    );
  } catch (error) {
    if (error instanceof AiGateError) return refused(error.reason, error.message, error);
    throw error;
  }

  const result = await provider.structured(providerRequest);
  const usage = result.usage;
  const costMicros = usage ? usageCostMicros(price, usage) : 0;
  const outcome = result.ok ? "ok" : result.reason;

  await recordUsage(
    {
      userId: request.userId,
      feature: request.feature,
      provider: provider.id,
      model,
      outcome,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cachedInputTokens: usage?.cachedInputTokens ?? 0,
      costMicros,
    },
    dependencies.gate,
  );
  log({
    feature: request.feature,
    provider: provider.id,
    model,
    outcome,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    costMicros,
    ...(!result.ok && result.detail ? { detail: result.detail } : {}),
  });

  const call: AiCall = { provider: provider.id, model, usage, costMicros };
  if (result.ok) return { ok: true, value: result.value, ...call, usage: result.usage };
  return { ok: false, called: true, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}), ...call };
}

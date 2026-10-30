import type { z } from "zod";

/**
 * The one interface every model call goes through (docs/statement-import-plan.md, "The provider
 * interface"; I15). A feature never imports a provider's SDK; it calls `structured` in
 * `src/lib/ai/index.ts`, which picks the adapter in `src/lib/ai/providers/<id>.ts`. A new provider
 * is one adapter file plus its rows in `pricing.ts`, and `contract.test.ts` runs against it.
 */

export type AiProviderId = "openai" | "fake"; // "anthropic", … added with their adapters

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number; // 0 when the provider doesn't report it
};

export type StructuredRequest<T> = {
  model: string;
  system: string; // fixed text first, so prefix caching works where the provider has it
  input: string; // the variable part
  schema: z.ZodType<T>; // the adapter turns it into the provider's JSON Schema format
  schemaName: string;
  maxOutputTokens: number;
  effort?: "none" | "low" | "medium" | "high"; // passed through where the provider has it
  timeoutMs: number;
  signal?: AbortSignal;
};

export type StructuredResult<T> =
  | { ok: true; value: T; usage: AiUsage; model: string }
  | {
      ok: false;
      reason: "max_tokens" | "refusal" | "invalid_output" | "timeout" | "rate_limited" | "provider_error";
      usage: AiUsage | null; // recorded when the provider billed the call
      /**
       * A few words for the log, such as `openai 401 invalid_api_key`: the status and code the
       * provider reported. Never the prompt, the input, the output or the provider's message.
       */
      detail?: string;
    };

export interface AiProvider {
  id: AiProviderId;
  /** Exact input token count when the provider offers one; otherwise null and the gate estimates. */
  countInputTokens(request: StructuredRequest<unknown>): Promise<number | null>;
  structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

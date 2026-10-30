import "server-only";

import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError, OpenAIError, RateLimitError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import type { AiProvider, AiUsage, StructuredRequest, StructuredResult } from "@/lib/ai/provider";

/**
 * The OpenAI adapter (docs/statement-import-plan.md, I15): the only file that imports the `openai`
 * package, and, with `import "server-only"`, kept out of every client and worker bundle.
 *
 * It uses the Responses API (`client.responses.create`) with a strict JSON Schema made from the
 * request's Zod schema by the SDK's `zodTextFormat` (which supports Zod 4 through `zod/v4`). The
 * SDK's own parsing is not used: the output text is parsed here with the request's schema, whatever
 * the model promised. Read against the SDK's types in `node_modules/openai` and OpenAI's structured
 * outputs guide:
 *
 * - Truncation: `status: "incomplete"` with `incomplete_details.reason` `max_output_tokens`.
 * - Refusal: an output message with a content part of type `refusal`, or an incomplete response with
 *   reason `content_filter`.
 * - Usage: `input_tokens` (which includes the cached ones), `input_tokens_details.cached_tokens`,
 *   `output_tokens` (reasoning included).
 * - Reasoning effort: `reasoning.effort`.
 * - Errors: `RateLimitError` (429), `APIConnectionTimeoutError`, `APIUserAbortError`, other `APIError`s.
 *
 * The request is sent with `store: false`, so OpenAI doesn't keep the statement text as a stored
 * response. Nothing here logs a prompt, an input or an output, and an error's message is never
 * copied: it can quote the request.
 */

export type OpenAiProviderOptions = {
  /** Defaults to `OPENAI_API_KEY`. */
  apiKey?: string;
  /** Defaults to OpenAI's API. Pinned so a stray `OPENAI_BASE_URL` can't send statements elsewhere. */
  baseURL?: string;
  /** A replacement for `fetch`; the contract tests replay recorded responses through it. */
  fetch?: typeof fetch;
  /** The SDK's own retries on rate limits, server errors and connection errors. Its default is 2. */
  maxRetries?: number;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function createOpenAiProvider(options: OpenAiProviderOptions = {}): AiProvider {
  let client: OpenAI | null = null;
  const getClient = () => {
    client ??= new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: options.baseURL ?? DEFAULT_BASE_URL,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    });
    return client;
  };

  return {
    id: "openai",

    /**
     * OpenAI counts a request's input tokens exactly (`responses.inputTokens.count`), so the gate
     * rarely has to estimate. A failure to count is null, not an error: the call itself may still go
     * ahead on the gate's estimate.
     */
    async countInputTokens(request) {
      const body = requestParams(request);
      try {
        const { input_tokens } = await getClient().responses.inputTokens.count(
          { model: body.model, instructions: body.instructions, input: body.input, text: body.text, reasoning: body.reasoning },
          { signal: request.signal, timeout: request.timeoutMs, maxRetries: 0 },
        );
        return Number.isSafeInteger(input_tokens) && input_tokens >= 0 ? input_tokens : null;
      } catch (error) {
        if (error instanceof OpenAIError) return null;
        throw error;
      }
    },

    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      // Building the request throws for a schema OpenAI can't take: that is a programming error.
      const body = requestParams(request);
      // One deadline for the whole call, retries included, on top of the SDK's per-attempt timeout.
      const deadline = AbortSignal.timeout(request.timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;

      let response: OpenAI.Responses.Response;
      try {
        response = await getClient().responses.create(body, { signal, timeout: request.timeoutMs });
      } catch (error) {
        return failureFromError(error, deadline);
      }
      return interpret(response, request);
    },
  };
}

function requestParams(request: StructuredRequest<unknown>) {
  return {
    model: request.model,
    instructions: request.system,
    input: request.input,
    text: { format: zodTextFormat(request.schema as Parameters<typeof zodTextFormat>[0], request.schemaName) },
    max_output_tokens: request.maxOutputTokens,
    store: false,
    ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
  };
}

function usageOf(response: OpenAI.Responses.Response): AiUsage | null {
  const usage = response.usage;
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
  };
}

function interpret<T>(response: OpenAI.Responses.Response, request: StructuredRequest<T>): StructuredResult<T> {
  const usage = usageOf(response);
  const fail = (reason: Extract<StructuredResult<T>, { ok: false }>["reason"], detail?: string): StructuredResult<T> => ({
    ok: false,
    reason,
    usage,
    ...(detail ? { detail } : {}),
  });

  if (response.status === "incomplete") {
    const why = response.incomplete_details?.reason;
    if (why === "max_output_tokens") return fail("max_tokens");
    if (why === "content_filter") return fail("refusal", "openai content_filter");
    return fail("provider_error", `openai incomplete ${why ?? "unknown"}`);
  }
  if (response.status === "failed") {
    const code = response.error?.code;
    return fail(code === "rate_limit_exceeded" ? "rate_limited" : "provider_error", `openai failed ${code ?? "unknown"}`);
  }
  if (response.status !== undefined && response.status !== "completed") return fail("provider_error", `openai status ${response.status}`);

  let text = "";
  let refused = false;
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "refusal") refused = true;
      else if (part.type === "output_text") text += part.text;
    }
  }
  if (refused) return fail("refusal");

  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return fail("invalid_output");
  }
  const parsed = request.schema.safeParse(candidate);
  if (!parsed.success || !usage) return fail(parsed.success ? "provider_error" : "invalid_output", parsed.success ? "openai reported no usage" : undefined);
  return { ok: true, value: parsed.data, usage, model: response.model };
}

function failureFromError(error: unknown, deadline: AbortSignal): StructuredResult<never> {
  // The call may have been billed, but there's nothing to read the tokens from.
  const fail = (reason: Extract<StructuredResult<never>, { ok: false }>["reason"], detail: string): StructuredResult<never> => ({
    ok: false,
    reason,
    usage: null,
    detail,
  });

  if (error instanceof APIUserAbortError) return deadline.aborted ? fail("timeout", "openai deadline") : fail("provider_error", "openai call cancelled");
  if (error instanceof APIConnectionTimeoutError) return fail("timeout", "openai timeout");
  if (error instanceof APIError) {
    const label = `openai ${error.status ?? "connection"}${error.code ? ` ${error.code}` : ""}`;
    // 429 also means "insufficient_quota": waiting won't help, so it isn't "rate limited".
    if (error instanceof RateLimitError && error.code !== "insufficient_quota") return fail("rate_limited", label);
    if (error.status === 408) return fail("timeout", label);
    return fail("provider_error", label);
  }
  if (error instanceof OpenAIError) return fail("provider_error", "openai error");
  throw error;
}

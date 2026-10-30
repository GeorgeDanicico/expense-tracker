import type { AiUsage } from "@/lib/ai/provider";

/**
 * Responses as OpenAI's Responses API sends them, for the contract tests to replay through the
 * SDK's `fetch` option (no network, no key). There was no API key when this was written, so the
 * bodies were not captured from a live call: they follow the SDK's own `Response` type in
 * `node_modules/openai/resources/responses/responses.d.ts` and OpenAI's structured outputs guide
 * (refusals are a `refusal` content part, truncation is `status: "incomplete"`). I19's live eval is
 * where a real answer is first seen; if one differs from these, fix the fixture and the adapter.
 */

const BASE = {
  id: "resp_recorded_0001",
  object: "response",
  created_at: 1_761_800_000,
  error: null,
  incomplete_details: null,
  instructions: null,
  metadata: {},
  model: "gpt-5.6-luna-2026-10-30",
  parallel_tool_calls: true,
  temperature: 1,
  tool_choice: "auto",
  tools: [],
  top_p: 1,
};

function usageBody(usage: AiUsage) {
  return {
    input_tokens: usage.inputTokens,
    input_tokens_details: { cached_tokens: usage.cachedInputTokens, cache_write_tokens: 0 },
    output_tokens: usage.outputTokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage.inputTokens + usage.outputTokens,
  };
}

const REASONING = { type: "reasoning", id: "rs_recorded_0001", summary: [] };

function message(content: unknown[], status: "completed" | "incomplete" = "completed") {
  return { type: "message", id: "msg_recorded_0001", role: "assistant", status, content };
}

/** A finished answer: the model's JSON text. */
export function completed(text: string, usage: AiUsage) {
  return { ...BASE, status: "completed", output: [REASONING, message([{ type: "output_text", text, annotations: [] }])], usage: usageBody(usage) };
}

/** An answer cut off at `max_output_tokens`: the text stops mid-JSON. */
export function truncated(partialText: string, usage: AiUsage) {
  return {
    ...BASE,
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [message([{ type: "output_text", text: partialText, annotations: [] }], "incomplete")],
    usage: usageBody(usage),
  };
}

/** The model declined: a `refusal` content part in place of the JSON. */
export function refused(usage: AiUsage) {
  return {
    ...BASE,
    status: "completed",
    output: [message([{ type: "refusal", refusal: "I can't help with that." }])],
    usage: usageBody(usage),
  };
}

/** The error body of a failed request, as OpenAI sends it with a 4xx or 5xx status. */
export function errorBody(code: string, type: string, message = "The request failed.") {
  return { error: { message, type, param: null, code } };
}

export type RecordedCall = { url: string; headers: Headers; body: Record<string, unknown> };

/** A `fetch` that answers from a queue of recorded responses and remembers what was sent. */
export function recordedTransport() {
  const queue: ((init: RequestInit) => Promise<Response>)[] = [];
  const calls: RecordedCall[] = [];
  const fetchStub: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: String(url), headers: new Headers(init?.headers), body });
    const next = queue.shift();
    if (!next) throw new Error("The recorded transport has no response queued.");
    return next(init ?? {});
  };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  return {
    fetch: fetchStub,
    calls,
    respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
      queue.push(async () => json(body, status, headers));
    },
    /** Never answers; ends when the caller gives up, as `fetch` does. */
    hang() {
      queue.push(
        (init) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
          }),
      );
    },
  };
}

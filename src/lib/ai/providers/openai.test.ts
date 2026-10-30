import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AiUsage, StructuredRequest } from "@/lib/ai/provider";
import { createOpenAiProvider } from "@/lib/ai/providers/openai";
import { completed, errorBody, recordedTransport, truncated } from "@/lib/ai/providers/openai.recorded";

// What only the OpenAI adapter does. What every adapter does is in `src/lib/ai/contract.test.ts`.

const USAGE: AiUsage = { inputTokens: 900, outputTokens: 80, cachedInputTokens: 512 };
const schema = z.object({ k: z.array(z.object({ c: z.enum(["food", "car"]), s: z.string().nullable() })) });
const answer = { k: [{ c: "food", s: null }] };

function request(overrides: Partial<StructuredRequest<z.infer<typeof schema>>> = {}): StructuredRequest<z.infer<typeof schema>> {
  return { model: "gpt-5.6-luna", system: "Fixed.", input: "Variable.", schema, schemaName: "merchant_categories", maxOutputTokens: 300, timeoutMs: 2000, ...overrides };
}

function setup(options: Parameters<typeof createOpenAiProvider>[0] = {}) {
  const transport = recordedTransport();
  const provider = createOpenAiProvider({ apiKey: "sk-test-not-a-real-key", fetch: transport.fetch, maxRetries: 0, ...options });
  return { transport, provider };
}

afterEach(() => vi.unstubAllEnvs());

describe("the OpenAI adapter's request", () => {
  it("posts a strict JSON Schema made from the Zod schema to the Responses API, unstored", async () => {
    const { transport, provider } = setup();
    transport.respond(completed(JSON.stringify(answer), USAGE));

    await provider.structured(request({ effort: "low" }));

    const call = transport.calls[0];
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    expect(call.headers.get("authorization")).toBe("Bearer sk-test-not-a-real-key");
    expect(call.body).toMatchObject({
      model: "gpt-5.6-luna",
      instructions: "Fixed.",
      input: "Variable.",
      max_output_tokens: 300,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "merchant_categories", strict: true } },
    });
    const format = (call.body.text as { format: { schema: Record<string, unknown> } }).format;
    expect(format.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["k"],
      properties: { k: { type: "array", items: { type: "object", additionalProperties: false, required: ["c", "s"] } } },
    });
    expect(JSON.stringify(format.schema)).toContain('"enum":["food","car"]');
    expect(JSON.stringify(format.schema)).toContain('"null"');
  });

  it("sends no reasoning setting unless the request has an effort", async () => {
    const { transport, provider } = setup();
    transport.respond(completed(JSON.stringify(answer), USAGE));

    await provider.structured(request());

    expect(transport.calls[0].body).not.toHaveProperty("reasoning");
  });

  it("uses the pinned base URL, whatever OPENAI_BASE_URL says", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://elsewhere.example.com/v1");
    const { transport, provider } = setup();
    transport.respond(completed(JSON.stringify(answer), USAGE));

    await provider.structured(request());

    expect(transport.calls[0].url).toBe("https://api.openai.com/v1/responses");
  });

  it("reads the key from OPENAI_API_KEY when it isn't given one", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-from-env");
    const transport = recordedTransport();
    const provider = createOpenAiProvider({ fetch: transport.fetch, maxRetries: 0 });
    transport.respond(completed(JSON.stringify(answer), USAGE));

    await provider.structured(request());

    expect(transport.calls[0].headers.get("authorization")).toBe("Bearer sk-test-from-env");
  });

  it("returns provider_error, not an exception, when there is no key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const provider = createOpenAiProvider({ fetch: recordedTransport().fetch });

    expect(await provider.structured(request())).toMatchObject({ ok: false, reason: "provider_error", usage: null });
    expect(await provider.countInputTokens(request())).toBeNull();
  });

  it("throws, as a programming error, for a schema OpenAI can't take", async () => {
    const { provider } = setup();
    const unrepresentable = z.object({ when: z.date() });

    await expect(provider.structured(request({ schema: unrepresentable } as unknown as Partial<StructuredRequest<z.infer<typeof schema>>>))).rejects.toThrow();
  });
});

describe("the OpenAI adapter's answers", () => {
  it("reports the model that answered and cached tokens as part of the input", async () => {
    const { transport, provider } = setup();
    transport.respond(completed(JSON.stringify(answer), USAGE));

    const result = await provider.structured(request());

    expect(result).toEqual({ ok: true, value: answer, usage: USAGE, model: "gpt-5.6-luna-2026-10-30" });
  });

  it("counts reasoning tokens as output, as OpenAI bills them", async () => {
    const { transport, provider } = setup();
    // output_tokens already includes the reasoning tokens in `output_tokens_details`.
    const body = completed(JSON.stringify(answer), { inputTokens: 900, outputTokens: 640, cachedInputTokens: 0 });
    body.usage.output_tokens_details = { reasoning_tokens: 560 };
    transport.respond(body);

    const result = await provider.structured(request());

    expect(result).toMatchObject({ ok: true, usage: { outputTokens: 640 } });
  });

  it("reads a missing cached-token count as zero", async () => {
    const { transport, provider } = setup();
    const body = completed(JSON.stringify(answer), USAGE) as { usage: Record<string, unknown> };
    delete body.usage.input_tokens_details;
    transport.respond(body);

    expect(await provider.structured(request())).toMatchObject({ ok: true, usage: { inputTokens: 900, cachedInputTokens: 0 } });
  });

  it("maps an incomplete response stopped by the content filter to a refusal, and any other stop to provider_error", async () => {
    const { transport, provider } = setup();
    const filtered = truncated("{", USAGE);
    filtered.incomplete_details = { reason: "content_filter" };
    const odd = truncated("{", USAGE);
    odd.incomplete_details = { reason: "max_messages" } as never;
    transport.respond(filtered);
    transport.respond(odd);

    expect(await provider.structured(request())).toMatchObject({ ok: false, reason: "refusal", usage: USAGE });
    expect(await provider.structured(request())).toMatchObject({ ok: false, reason: "provider_error", usage: USAGE });
  });

  it("maps a response that failed on OpenAI's side, keeping the tokens it reports", async () => {
    const { transport, provider } = setup();
    const failed = completed("", USAGE) as Record<string, unknown>;
    failed.status = "failed";
    failed.error = { code: "rate_limit_exceeded", message: "Slow down." };
    const broken = { ...failed, error: { code: "server_error", message: "Oops." } };
    transport.respond(failed);
    transport.respond(broken);

    expect(await provider.structured(request())).toMatchObject({ ok: false, reason: "rate_limited", usage: USAGE });
    expect(await provider.structured(request())).toMatchObject({ ok: false, reason: "provider_error", usage: USAGE });
  });
});

describe("the OpenAI adapter's errors", () => {
  it("says which status and code failed, never the provider's message", async () => {
    const { transport, provider } = setup();
    transport.respond(errorBody("invalid_api_key", "invalid_request_error", "Incorrect API key provided: sk-test-no***ey. Input was: Variable."), 401);

    const result = await provider.structured(request());

    expect(result).toEqual({ ok: false, reason: "provider_error", usage: null, detail: "openai 401 invalid_api_key" });
  });

  it("treats a spent quota as a provider error, because waiting won't fix it", async () => {
    const { transport, provider } = setup();
    transport.respond(errorBody("insufficient_quota", "insufficient_quota"), 429);

    expect(await provider.structured(request())).toMatchObject({ ok: false, reason: "provider_error", detail: "openai 429 insufficient_quota" });
  });

  it("reports a refused connection as a provider error", async () => {
    const transport = recordedTransport();
    const provider = createOpenAiProvider({ apiKey: "sk-test", fetch: transport.fetch, maxRetries: 0 });
    // Nothing queued: the stub throws, as a failed connection does.
    expect(await provider.structured(request())).toMatchObject({ ok: false, reason: "provider_error", usage: null, detail: "openai connection" });
  });

  it("retries a rate limit as the SDK does, and the retry's answer is the result", async () => {
    const { transport, provider } = setup({ maxRetries: 2 });
    transport.respond(errorBody("rate_limit_exceeded", "requests"), 429, { "retry-after-ms": "1" });
    transport.respond(completed(JSON.stringify(answer), USAGE));

    const result = await provider.structured(request());

    expect(result).toMatchObject({ ok: true, value: answer });
    expect(transport.calls).toHaveLength(2);
  });

  it("gives up on a call that outlasts its deadline, retries included", async () => {
    const { transport, provider } = setup({ maxRetries: 2 });
    transport.hang();

    const result = await provider.structured(request({ timeoutMs: 30 }));

    expect(result).toMatchObject({ ok: false, reason: "timeout", detail: "openai deadline" });
    expect(transport.calls).toHaveLength(1);
  });

  it("stops when the caller's signal aborts, which is not a timeout", async () => {
    const { transport, provider } = setup();
    transport.hang();
    const controller = new AbortController();
    const pending = provider.structured(request({ signal: controller.signal, timeoutMs: 5000 }));
    controller.abort();

    expect(await pending).toMatchObject({ ok: false, reason: "provider_error", detail: "openai call cancelled" });
  });
});

describe("the OpenAI adapter's input token count", () => {
  it("asks OpenAI to count the same request and returns its number", async () => {
    const { transport, provider } = setup();
    transport.respond({ object: "response.input_tokens", input_tokens: 4321 });

    const count = await provider.countInputTokens(request({ effort: "none" }));

    expect(count).toBe(4321);
    expect(transport.calls[0].url).toBe("https://api.openai.com/v1/responses/input_tokens");
    expect(transport.calls[0].body).toMatchObject({
      model: "gpt-5.6-luna",
      instructions: "Fixed.",
      input: "Variable.",
      reasoning: { effort: "none" },
      text: { format: { type: "json_schema", name: "merchant_categories", strict: true } },
    });
    expect(transport.calls[0].body).not.toHaveProperty("max_output_tokens");
  });

  it("is null when OpenAI can't count, so the gate estimates", async () => {
    const { transport, provider } = setup();
    transport.respond(errorBody("server_error", "server_error"), 500);
    transport.respond({ object: "response.input_tokens", input_tokens: "many" });

    expect(await provider.countInputTokens(request())).toBeNull();
    expect(await provider.countInputTokens(request())).toBeNull();
  });
});

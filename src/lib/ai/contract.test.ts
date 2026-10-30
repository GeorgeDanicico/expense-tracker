import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AiProvider, AiUsage, StructuredRequest } from "@/lib/ai/provider";
import { FakeProvider } from "@/lib/ai/providers/fake";
import { createOpenAiProvider } from "@/lib/ai/providers/openai";
import { completed, errorBody, recordedTransport, refused, truncated } from "@/lib/ai/providers/openai.recorded";

/**
 * The contract every adapter follows (docs/statement-import-plan.md, "The provider interface"), run
 * against each one. The fake runs as a real adapter would; the OpenAI adapter runs through the SDK
 * with a transport that replays recorded responses, so no network and no key are involved.
 *
 * To add a provider: write a harness for it below that turns a scenario into that provider's own
 * wire response, and add it to the list at the bottom.
 */

/** What the provider does on the next call, in terms every adapter can be scripted with. */
type Scenario =
  | { kind: "answer"; text: string; usage: AiUsage }
  | { kind: "cut_off"; partialText: string; usage: AiUsage }
  | { kind: "declined"; usage: AiUsage }
  | { kind: "too_slow" }
  | { kind: "too_many_requests" }
  | { kind: "broken" };

/** What reached the provider, in the interface's own terms. */
type Sent = {
  model: string;
  system: string;
  input: string;
  maxOutputTokens: number;
  effort: string | undefined;
  /** The JSON Schema the adapter gave the provider, when the provider takes one. */
  jsonSchema?: Record<string, unknown>;
};

type Harness = {
  provider: AiProvider;
  script(scenario: Scenario): void;
  sent(): Sent | undefined;
};

const USAGE: AiUsage = { inputTokens: 1200, outputTokens: 150, cachedInputTokens: 1024 };
const SECRET_SYSTEM = "SYSTEM-MARKER-7f3a";
const SECRET_INPUT = "INPUT-MARKER-91c2";

const schema = z.object({
  k: z.array(z.object({ c: z.enum(["food", "car", "other"]), s: z.string().nullable() })),
});
type Answer = z.infer<typeof schema>;
const answer: Answer = { k: [{ c: "food", s: null }, { c: "car", s: "fuel" }] };

function request(overrides: Partial<StructuredRequest<Answer>> = {}): StructuredRequest<Answer> {
  return {
    model: "test-model",
    system: SECRET_SYSTEM,
    input: SECRET_INPUT,
    schema,
    schemaName: "merchant_categories",
    maxOutputTokens: 500,
    timeoutMs: 2000,
    ...overrides,
  };
}

function fakeHarness(): Harness {
  const provider = new FakeProvider();
  return {
    provider,
    script(scenario) {
      switch (scenario.kind) {
        case "answer":
          provider.willReturnText(scenario.text, scenario.usage);
          break;
        case "cut_off":
          provider.willFail("max_tokens", scenario.usage);
          break;
        case "declined":
          provider.willFail("refusal", scenario.usage);
          break;
        case "too_slow":
          provider.willFail("timeout");
          break;
        case "too_many_requests":
          provider.willFail("rate_limited");
          break;
        case "broken":
          provider.willFail("provider_error");
          break;
      }
    },
    sent() {
      const last = provider.requests.at(-1);
      if (!last) return undefined;
      return { model: last.model, system: last.system, input: last.input, maxOutputTokens: last.maxOutputTokens, effort: last.effort };
    },
  };
}

function openAiHarness(): Harness {
  const transport = recordedTransport();
  const provider = createOpenAiProvider({ apiKey: "sk-test-not-a-real-key", fetch: transport.fetch, maxRetries: 0 });
  return {
    provider,
    script(scenario) {
      switch (scenario.kind) {
        case "answer":
          transport.respond(completed(scenario.text, scenario.usage));
          break;
        case "cut_off":
          transport.respond(truncated(scenario.partialText, scenario.usage));
          break;
        case "declined":
          transport.respond(refused(scenario.usage));
          break;
        case "too_slow":
          transport.hang();
          break;
        case "too_many_requests":
          transport.respond(errorBody("rate_limit_exceeded", "requests"), 429);
          break;
        case "broken":
          transport.respond(errorBody("server_error", "server_error"), 500);
          break;
      }
    },
    sent() {
      const last = transport.calls.at(-1);
      if (!last) return undefined;
      const text = last.body.text as { format?: { schema?: Record<string, unknown> } } | undefined;
      return {
        model: last.body.model as string,
        system: last.body.instructions as string,
        input: last.body.input as string,
        maxOutputTokens: last.body.max_output_tokens as number,
        effort: (last.body.reasoning as { effort?: string } | undefined)?.effort,
        jsonSchema: text?.format?.schema,
      };
    },
  };
}

const harnesses: [string, () => Harness][] = [
  ["fake", fakeHarness],
  ["openai", openAiHarness],
];

describe.each(harnesses)("the AiProvider contract: %s", (_name, makeHarness) => {
  let harness: Harness;
  let console_: Record<"log" | "info" | "warn" | "error" | "debug", ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    harness = makeHarness();
    console_ = {
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the parsed value with the usage the provider billed, cached tokens included", async () => {
    harness.script({ kind: "answer", text: JSON.stringify(answer), usage: USAGE });

    const result = await harness.provider.structured(request());

    expect(result).toMatchObject({ ok: true, value: answer, usage: USAGE });
    expect(result.ok && result.model).toEqual(expect.any(String));
  });

  it("parses the value with the request's schema, not the provider's promise", async () => {
    const trimming = z.object({ name: z.string().trim() });
    harness.script({ kind: "answer", text: JSON.stringify({ name: "  Lidl  " }), usage: USAGE });

    const result = await harness.provider.structured(request({ schema: trimming } as unknown as Partial<StructuredRequest<Answer>>));

    expect(result).toMatchObject({ ok: true, value: { name: "Lidl" } });
  });

  it.each([
    ["JSON of the wrong shape", JSON.stringify({ k: [{ c: "fuel", s: null }] })],
    ["JSON missing a field", JSON.stringify({ k: [{ c: "food" }] })],
    ["JSON with the wrong type", JSON.stringify({ k: "food" })],
    ["text that isn't JSON", "Sure! Here are the categories: food, car."],
    ["nothing at all", ""],
  ])("returns invalid_output, with the usage, for %s", async (_what, text) => {
    harness.script({ kind: "answer", text, usage: USAGE });

    const result = await harness.provider.structured(request());

    expect(result).toMatchObject({ ok: false, reason: "invalid_output", usage: USAGE });
  });

  it("returns max_tokens, with the usage, for an answer cut off at the output cap", async () => {
    harness.script({ kind: "cut_off", partialText: '{"k":[{"c":"food","s":nu', usage: { inputTokens: 1200, outputTokens: 500, cachedInputTokens: 0 } });

    const result = await harness.provider.structured(request());

    expect(result).toMatchObject({ ok: false, reason: "max_tokens", usage: { inputTokens: 1200, outputTokens: 500, cachedInputTokens: 0 } });
  });

  it("returns refusal, with the usage, for an answer the model declined", async () => {
    harness.script({ kind: "declined", usage: USAGE });

    const result = await harness.provider.structured(request());

    expect(result).toMatchObject({ ok: false, reason: "refusal", usage: USAGE });
  });

  it("returns timeout when the provider is too slow", async () => {
    harness.script({ kind: "too_slow" });

    const result = await harness.provider.structured(request({ timeoutMs: 40 }));

    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("returns rate_limited when the provider says to slow down", async () => {
    harness.script({ kind: "too_many_requests" });

    expect(await harness.provider.structured(request())).toMatchObject({ ok: false, reason: "rate_limited", usage: null });
  });

  it("returns provider_error when the provider fails", async () => {
    harness.script({ kind: "broken" });

    expect(await harness.provider.structured(request())).toMatchObject({ ok: false, reason: "provider_error", usage: null });
  });

  it("returns, doesn't throw, for each way a call can fail, and the next call still works", async () => {
    for (const scenario of [
      { kind: "cut_off", partialText: "{", usage: USAGE },
      { kind: "declined", usage: USAGE },
      { kind: "too_many_requests" },
      { kind: "broken" },
      { kind: "answer", text: "nope", usage: USAGE },
    ] as const) {
      harness.script(scenario);
      await expect(harness.provider.structured(request())).resolves.toMatchObject({ ok: false });
    }
    harness.script({ kind: "answer", text: JSON.stringify(answer), usage: USAGE });
    await expect(harness.provider.structured(request())).resolves.toMatchObject({ ok: true });
  });

  it("sends the fixed text and the variable text separately, with the model, the cap and the effort", async () => {
    harness.script({ kind: "answer", text: JSON.stringify(answer), usage: USAGE });

    await harness.provider.structured(request({ effort: "none", maxOutputTokens: 777 }));

    expect(harness.sent()).toMatchObject({ model: "test-model", system: SECRET_SYSTEM, input: SECRET_INPUT, maxOutputTokens: 777, effort: "none" });
  });

  it("leaves the effort to the provider's default when the request has none", async () => {
    harness.script({ kind: "answer", text: JSON.stringify(answer), usage: USAGE });

    await harness.provider.structured(request());

    expect(harness.sent()?.effort).toBeUndefined();
  });

  it("never logs, and never puts the prompt, the input or the answer in a failure", async () => {
    const results = [];
    for (const scenario of [
      { kind: "declined", usage: USAGE },
      { kind: "answer", text: `{"leak":"${SECRET_INPUT}"}`, usage: USAGE },
      { kind: "too_many_requests" },
      { kind: "broken" },
    ] as const) {
      harness.script(scenario);
      results.push(await harness.provider.structured(request()));
    }

    const text = JSON.stringify(results);
    expect(text).not.toContain(SECRET_SYSTEM);
    expect(text).not.toContain(SECRET_INPUT);
    for (const spy of Object.values(console_)) expect(spy).not.toHaveBeenCalled();
  });

  it("counts input tokens as a whole number or null, and doesn't throw", async () => {
    const count = await harness.provider.countInputTokens(request());

    expect(count === null || (Number.isSafeInteger(count) && count >= 0)).toBe(true);
  });
});

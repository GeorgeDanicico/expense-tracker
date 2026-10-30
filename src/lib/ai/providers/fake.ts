import type { AiProvider, AiUsage, StructuredRequest, StructuredResult } from "@/lib/ai/provider";

// No imports from the gate or the repositories: route tests mock `@/lib/repositories` with fakes that
// load the fake gate repository, and a module here that reached back to the gate would make a cycle
// that never finishes loading (the I14 note on `src/test/fakes/ai.ts`).

type Failure = Extract<StructuredResult<unknown>, { ok: false }>;

type Step =
  | { kind: "value"; value: unknown; usage: AiUsage; model: string }
  | { kind: "text"; text: string; usage: AiUsage; model: string }
  | { kind: "failure"; reason: Failure["reason"]; usage: AiUsage | null; detail?: string };

/** Usage a scripted success reports when the test doesn't choose one. */
export const FAKE_USAGE: AiUsage = { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0 };

/**
 * An `AiProvider` that makes no call: it takes the next scripted step. A value is checked against the
 * request's schema as a real adapter checks a provider's answer, so a scripted value the schema
 * rejects comes back as `invalid_output`. Nothing scripted is a programming error and throws.
 * `requests` lists what it was asked, and `inputTokenCount` is what `countInputTokens` reports
 * (null: the provider can't count, so the gate estimates).
 */
export class FakeProvider implements AiProvider {
  readonly id = "fake" as const;
  readonly requests: StructuredRequest<unknown>[] = [];
  inputTokenCount: number | null = null;
  private script: Step[] = [];

  /** The next call answers with `value` (checked against the schema) and reports `usage`. */
  willReturn(value: unknown, usage: AiUsage = FAKE_USAGE, model = "fake-model") {
    this.script.push({ kind: "value", value, usage, model });
    return this;
  }

  /** The next call answers with this raw text, which must be JSON that the schema accepts. */
  willReturnText(text: string, usage: AiUsage = FAKE_USAGE, model = "fake-model") {
    this.script.push({ kind: "text", text, usage, model });
    return this;
  }

  /** The next call fails with `reason`; the provider billed `usage` for it, or nothing (null). */
  willFail(reason: Failure["reason"], usage: AiUsage | null = null, detail?: string) {
    this.script.push({ kind: "failure", reason, usage, detail });
    return this;
  }

  async countInputTokens(): Promise<number | null> {
    return this.inputTokenCount;
  }

  async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(request);
    const step = this.script.shift();
    if (!step) throw new Error("FakeProvider: a call was made with nothing scripted for it.");
    if (step.kind === "failure") return { ok: false, reason: step.reason, usage: step.usage, ...(step.detail ? { detail: step.detail } : {}) };

    let candidate = step.kind === "value" ? step.value : undefined;
    if (step.kind === "text") {
      try {
        candidate = JSON.parse(step.text);
      } catch {
        return { ok: false, reason: "invalid_output", usage: step.usage };
      }
    }
    const parsed = request.schema.safeParse(candidate);
    if (!parsed.success) return { ok: false, reason: "invalid_output", usage: step.usage };
    return { ok: true, value: parsed.data, usage: step.usage, model: step.model };
  }
}

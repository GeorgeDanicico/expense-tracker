import { z } from "zod";

import type { AiProvider, AiUsage, StructuredRequest, StructuredResult } from "@/lib/ai/provider";

/**
 * The stand-in model of `--dry-run` (docs/statement-import-plan.md, I19): it makes no call and
 * needs no key, and answers every request with the answer it was given for that exact input, which
 * the harness works out from the expected rows. Running the eval with it tests the harness (the
 * numbering, the reader's code, verification, scoring, the report) end to end. Its answers are
 * checked against the request's schema as a real adapter checks a provider's, and its token counts
 * are invented from the length of the text (three characters to a token, the system prompt
 * reported as cached after the first call), so nothing it reports is a measurement of a model.
 */

export type OracleAnswers = ReadonlyMap<string, unknown>;

/** The key under which a call's answer is registered. */
export const oracleKey = (schemaName: string, input: string) => `${schemaName}\u0000${input}`;

export function createOracleProvider(answers: OracleAnswers): AiProvider {
  let calls = 0;
  return {
    id: "fake",
    async countInputTokens() {
      return null;
    },
    async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const answer = answers.get(oracleKey(request.schemaName, request.input));
      if (answer === undefined) throw new Error("The dry run has no answer for this request.");

      const schemaJson = JSON.stringify(z.toJSONSchema(request.schema, { io: "input", unrepresentable: "any" }));
      const prompt = Math.ceil((request.system.length + schemaJson.length) / 3);
      const usage: AiUsage = {
        inputTokens: prompt + Math.ceil(request.input.length / 3),
        cachedInputTokens: calls === 0 ? 0 : prompt,
        outputTokens: Math.ceil(JSON.stringify(answer).length / 3),
      };
      calls += 1;

      const parsed = request.schema.safeParse(answer);
      if (!parsed.success) return { ok: false, reason: "invalid_output", usage };
      return { ok: true, value: parsed.data, usage, model: request.model };
    },
  };
}

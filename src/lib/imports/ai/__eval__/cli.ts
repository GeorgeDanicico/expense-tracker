import { parseArgs } from "node:util";

import { findPrice, PRICING } from "@/lib/ai/pricing";
import type { AiProvider } from "@/lib/ai/provider";
import {
  EFFORTS,
  estimateCost,
  planJobs,
  prepareStatement,
  runJobs,
  type Effort,
  type Mode,
  type PreparedStatement,
  type StatementResult,
} from "@/lib/imports/ai/__eval__/harness";
import { createOracleProvider, oracleKey } from "@/lib/imports/ai/__eval__/oracle";
import { dollars, renderMarkdown, type Report } from "@/lib/imports/ai/__eval__/report";
import type { EvalStatement } from "@/lib/imports/ai/__eval__/types";
import { CATEGORISE_SCHEMA_NAME, READER_SCHEMA_NAME } from "@/lib/imports/ai/prompts";

/**
 * The command line of the statement eval (docs/statement-import-plan.md, I19), kept apart from
 * `run.ts` so a test can drive it with a fake terminal and a fake provider.
 *
 *   npm run eval:statements -- --model <id> [--provider <id>] [--effort none|low|medium|high]
 *                              [--mode read|categorise|both] [--only <id>,<id>] [--dry-run]
 *
 * A live run refuses without a key, prints what it expects to cost, and waits for the word
 * "spend" before the first call. `--dry-run` needs neither: it plays the expected answers back
 * through a stand-in provider.
 */

export const USAGE = `Usage: npm run eval:statements -- --model <id> [options]

  --model <id>        The model to evaluate, as the provider names it (for example gpt-5.6-luna). It must have a price in src/lib/ai/pricing.ts.
  --provider <id>     The provider; defaults to AI_PROVIDER, then openai. Only openai has an adapter so far.
  --effort <level>    Reasoning effort: none (default), low, medium or high.
  --mode <mode>       read, categorise or both (default). Categorise only runs for statements a parser reads.
  --only <ids>        Run only these statements, comma-separated.
  --dry-run           Run the whole harness offline with a stand-in model that returns the expected answers.
                      No key, no cost. The output is not a result.

A live run spends real money: it needs OPENAI_API_KEY, prints an estimate, and asks you to type "spend".
`;

export const CONFIRMATION_WORD = "spend";
const DRY_RUN_MODEL = "gpt-5.6-luna";

/** Everything the command touches outside itself, so a test can replace it. */
export type CliIo = {
  out(line: string): void;
  err(line: string): void;
  /** Whether there is a person to type a confirmation. */
  interactive: boolean;
  confirm(question: string): Promise<string>;
  now(): Date;
  /** Writes a file under the git-ignored results directory and returns where. */
  writeResults(fileName: string, content: string): Promise<string>;
  loadStatements(): Promise<EvalStatement[]>;
  createProvider(id: string, apiKey: string): Promise<AiProvider>;
};

type Parsed =
  | { ok: true; model: string | null; provider: string | null; effort: Effort; modes: Mode[]; only: string[] | null; dryRun: boolean; help: boolean }
  | { ok: false; message: string };

export function parseCli(argv: readonly string[]): Parsed {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        model: { type: "string" },
        provider: { type: "string" },
        effort: { type: "string" },
        mode: { type: "string" },
        only: { type: "string" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unreadable arguments." };
  }

  const effort = values.effort ?? "none";
  if (!(EFFORTS as readonly string[]).includes(effort)) return { ok: false, message: `--effort must be one of ${EFFORTS.join(", ")}.` };
  const mode = values.mode ?? "both";
  if (mode !== "read" && mode !== "categorise" && mode !== "both") return { ok: false, message: "--mode must be read, categorise or both." };

  return {
    ok: true,
    model: values.model?.trim() || null,
    provider: values.provider?.trim() || null,
    effort: effort as Effort,
    modes: mode === "both" ? ["read", "categorise"] : [mode],
    only: values.only ? values.only.split(",").map((id) => id.trim()).filter(Boolean) : null,
    dryRun: values["dry-run"] === true,
    help: values.help === true,
  };
}

const slug = (text: string) => text.replace(/[^A-Za-z0-9.-]+/g, "_");

/** Runs the eval. Returns the process's exit code: 0 done, 1 refused or cancelled, 2 bad arguments. */
export async function main(argv: readonly string[], env: Record<string, string | undefined>, io: CliIo): Promise<number> {
  const args = parseCli(argv);
  if (!args.ok) {
    io.err(`${args.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    io.out(USAGE);
    return 0;
  }

  const dryRun = args.dryRun;
  const model = args.model ?? (dryRun ? DRY_RUN_MODEL : null);
  if (!model) {
    io.err(`--model is required, so a run never picks a model by accident.\n\n${USAGE}`);
    return 2;
  }

  // The provider that is called, or, for a dry run, the one whose prices are used.
  const providerId = args.provider ?? (env.AI_PROVIDER?.trim() || "openai");
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!dryRun) {
    if (providerId !== "openai") {
      io.err(`There is no adapter for the provider "${providerId}" yet; only openai. A second provider is one adapter file under src/lib/ai/providers.`);
      return 1;
    }
    if (!apiKey) {
      io.err("OPENAI_API_KEY is not set. This eval makes real, paid calls and refuses to start without a key. Put it in .env.local or the environment, or use --dry-run to test the harness without one.");
      return 1;
    }
  }
  const price = findPrice(dryRun ? "openai" : providerId, model, PRICING);
  if (!price) {
    io.err(`${dryRun ? "openai" : providerId} ${model} has no price in src/lib/ai/pricing.ts, so its cost can't be worked out. Add the price first.`);
    return 1;
  }

  let statements = await io.loadStatements();
  if (args.only) {
    const unknown = args.only.filter((id) => !statements.some((statement) => statement.id === id));
    if (unknown.length > 0) {
      io.err(`No statement called ${unknown.join(", ")}.`);
      return 2;
    }
    statements = statements.filter((statement) => args.only?.includes(statement.id));
  }
  if (dryRun) {
    const playable = statements.filter((statement) => statement.answer !== null);
    if (playable.length < statements.length) {
      io.out(`Dry run: leaving out ${statements.length - playable.length} statements with no answer.json (samples), since there is nothing to play back for them.`);
    }
    statements = playable;
  }

  const prepared: PreparedStatement[] = [];
  for (const statement of statements) prepared.push(await prepareStatement(statement));
  const { jobs, skipped } = planJobs(prepared, args.modes);
  if (jobs.length === 0) {
    io.err("Nothing to run for those statements and that mode.");
    return 1;
  }

  const estimate = estimateCost(jobs, price);
  io.out(
    [
      `${dryRun ? "Dry run (fake provider, priced as openai" : `Provider ${providerId},`} ${model}${dryRun ? ")" : ""}, effort ${args.effort}: ${estimate.calls} calls over ${statements.length} statements.`,
      `Estimated input ${estimate.inputTokens} tokens (three characters to the token, nothing cached), expected output about ${estimate.expectedOutputTokens} tokens (the plan's 30 per transaction and 8 per merchant), at most ${estimate.worstOutputTokens} (every call writing its whole cap).`,
      `Estimated cost ${dollars(estimate.expectedMicros)}, at most ${dollars(estimate.worstMicros)}${reasoningNote(args.effort)}.`,
    ].join("\n"),
  );

  let provider: AiProvider;
  if (dryRun) {
    const answers = new Map<string, unknown>();
    for (const job of jobs) {
      if (job.perfectAnswer !== null) answers.set(oracleKey(job.mode === "read" ? READER_SCHEMA_NAME : CATEGORISE_SCHEMA_NAME, job.input), job.perfectAnswer);
    }
    provider = createOracleProvider(answers);
  } else {
    if (!io.interactive) {
      io.err(`This run needs a person to confirm its cost, and there is no terminal to type in. Run it from a terminal.`);
      return 1;
    }
    const answer = await io.confirm(`This makes ${estimate.calls} real, billed calls. Type "${CONFIRMATION_WORD}" to go ahead, anything else to stop: `);
    if (answer.trim() !== CONFIRMATION_WORD) {
      io.out("Stopped before any call. Nothing was spent.");
      return 1;
    }
    provider = await io.createProvider(providerId, apiKey);
  }

  const startedAt = io.now();
  const meta = { provider: dryRun ? "fake" : providerId, model, effort: args.effort, dryRun, at: startedAt.toISOString() };
  const fileName = `${dryRun ? "dry-run-" : ""}statements-${slug(meta.provider)}-${slug(model)}-${args.effort}-${meta.at.replace(/[:.]/g, "-")}.json`;
  const raw = (done: StatementResult[]) => JSON.stringify({ meta, estimate, skipped, results: done }, null, 2);

  const soFar: StatementResult[] = [];
  const results = await runJobs(jobs, {
    provider,
    model,
    effort: args.effort,
    price,
    onResult: async (result, done, total) => {
      io.out(`[${done}/${total}] ${result.mode} ${result.id}: ${result.outcome}${result.detail ? ` (${result.detail})` : ""}, ${dollars(result.costMicros)}`);
      // Saved as it goes, so stopping the run halfway loses nothing that was paid for.
      soFar.push(result);
      await io.writeResults(fileName, raw(soFar));
    },
  });

  const report: Report = { meta, results, skipped, estimate };
  io.out("");
  io.out(renderMarkdown(report));
  const where = await io.writeResults(fileName, raw(results));
  io.out(`Raw results, including every answer: ${where}`);
  return 0;
}

const reasoningNote = (level: Effort) => (level === "none" ? "" : ` (reasoning tokens at effort ${level} are billed as output and come on top of the expected figure; the cap includes them)`);

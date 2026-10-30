import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { main, type CliIo } from "@/lib/imports/ai/__eval__/cli";
import { loadStatements } from "@/lib/imports/ai/__eval__/load";

/**
 * The hand-run, live eval of the statement reader (docs/statement-import-plan.md, I19):
 *
 *   npm run eval:statements -- --model gpt-5.6-luna
 *
 * **It spends real money**, so it only ever runs by hand: never in CI, and `npm test` doesn't
 * touch it (the offline `--dry-run` is what the tests run). It needs `OPENAI_API_KEY` in the
 * environment or in `.env.local` (read here, because a plain `node` doesn't load Next's env
 * files), prints an estimate of what it will cost, and waits for you to type "spend".
 *
 * It calls the statement reader's own code (prompts, schemas, output caps, verification) and
 * sends the model call straight to the provider adapter, then prices the usage from
 * `src/lib/ai/pricing.ts`. It does NOT go through `structured` in `src/lib/ai/index.ts`, and so
 * skips the per-user budget gate and the usage ledger: there is no signed-in user, no family and no
 * database here, and a hand-run eval shouldn't count against anyone's $3 month or write rows. The
 * budget it respects is the one you confirm.
 *
 * Results go to the console as a Markdown table to paste into a PR, and in full (every answer
 * included) to `eval-results/`, which git ignores.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the key may be in the environment already.
}

const RESULTS_DIR = path.join(process.cwd(), "eval-results");

const io: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  interactive: process.stdin.isTTY === true,
  async confirm(question) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await terminal.question(question);
    } finally {
      terminal.close();
    }
  },
  now: () => new Date(),
  async writeResults(fileName, content) {
    await mkdir(RESULTS_DIR, { recursive: true });
    const file = path.join(RESULTS_DIR, fileName);
    await writeFile(file, content);
    return path.relative(process.cwd(), file);
  },
  loadStatements: () => loadStatements(),
  async createProvider(id, apiKey) {
    if (id !== "openai") throw new Error(`No adapter for ${id}.`);
    // Loaded here so a dry run never reads the SDK.
    const { createOpenAiProvider } = await import("@/lib/ai/providers/openai");
    return createOpenAiProvider({ apiKey });
  },
};

process.exitCode = await main(process.argv.slice(2), process.env, io);

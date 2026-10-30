import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findPrice, PRICING } from "@/lib/ai/pricing";
import type { AiProvider } from "@/lib/ai/provider";
import { FakeProvider } from "@/lib/ai/providers/fake";
import { CONFIRMATION_WORD, main, parseCli, type CliIo } from "@/lib/imports/ai/__eval__/cli";
import { FIXTURES_DIR, fixtureFiles } from "@/lib/imports/ai/__eval__/fixture-files";
import { estimateCost, estimateJobInputTokens, planJobs, prepareStatement, runJobs, type StatementResult } from "@/lib/imports/ai/__eval__/harness";
import { loadStatements, pdfFromText } from "@/lib/imports/ai/__eval__/load";
import { renderMarkdown } from "@/lib/imports/ai/__eval__/report";
import { merchantMatches, scoreReading } from "@/lib/imports/ai/__eval__/score";
import type { EvalStatement } from "@/lib/imports/ai/__eval__/types";
import { generateAll } from "@/lib/imports/ai/__eval__/statements";
import { extractPdfText } from "@/lib/imports/pdf-text";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import type { VerifiedRow } from "@/lib/imports/ai/verify";

/**
 * The eval harness without a model (docs/statement-import-plan.md, I19). Nothing here calls a
 * provider: the "model" is the offline stand-in of `--dry-run` or a scripted `FakeProvider`, so this
 * runs with `npm test` and costs nothing. The live eval itself is `npm run eval:statements`, which
 * is never part of the tests.
 */

const LUNA = findPrice("openai", "gpt-5.6-luna", PRICING)!;

async function statements(): Promise<EvalStatement[]> {
  return loadStatements([FIXTURES_DIR]);
}

type Terminal = {
  io: CliIo;
  out: string[];
  err: string[];
  written: { fileName: string; content: string }[];
  providersCreated: string[];
  asked: string[];
};

function terminal(options: { interactive?: boolean; answer?: string; provider?: () => AiProvider; only?: string[] } = {}): Terminal {
  const t: Terminal = { out: [], err: [], written: [], providersCreated: [], asked: [], io: undefined as unknown as CliIo };
  t.io = {
    out: (line) => t.out.push(line),
    err: (line) => t.err.push(line),
    interactive: options.interactive ?? true,
    confirm: async (question) => {
      t.asked.push(question);
      return options.answer ?? "";
    },
    now: () => new Date("2026-10-30T12:00:00Z"),
    writeResults: async (fileName, content) => {
      t.written.push({ fileName, content });
      return `eval-results/${fileName}`;
    },
    loadStatements: statements,
    createProvider: async (id) => {
      t.providersCreated.push(id);
      if (!options.provider) throw new Error("A provider was created when none should be.");
      return options.provider();
    },
  };
  return t;
}

afterEach(() => vi.unstubAllGlobals());

describe("the synthetic statements", () => {
  it("are on disk exactly as the generator produces them, with nothing left over", async () => {
    const files = fixtureFiles();
    const onDisk = (await readdir(FIXTURES_DIR)).sort();

    expect(onDisk).toEqual([...files.keys()].sort());
    for (const [name, content] of files) {
      expect(Buffer.compare(await readFile(path.join(FIXTURES_DIR, name)), Buffer.from(content)), `${name} differs: run npm run eval:statements:generate`).toBe(0);
    }
  });

  it("cover the shapes the plan asks for", async () => {
    const all = await statements();
    const rows = all.flatMap((statement) => statement.expected.rows);

    expect(all.some((s) => s.kind === "csv") && all.some((s) => s.kind === "pdf")).toBe(true);
    expect(all.some((s) => /Romanian/.test(s.expected.description))).toBe(true);
    expect(all.some((s) => /English/.test(s.expected.description))).toBe(true);
    expect(all.some((s) => /comma decimals/.test(s.expected.description))).toBe(true);
    expect(all.some((s) => /dot decimals/.test(s.expected.description))).toBe(true);
    expect(all.some((s) => /several lines|two or three lines|over two or three lines|continue on a second line/.test(s.expected.description))).toBe(true);
    expect(rows.some((row) => row.currency !== "RON")).toBe(true);
    expect(rows.some((row) => row.direction === "credit")).toBe(true);
    expect(all.some((s) => /printed total/.test(s.expected.description))).toBe(true);
    // The shapes that were known gaps of the reader before I20 stay in the set, now as ordinary statements.
    expect(all.find((s) => /day and month only/.test(s.expected.description))?.id).toBe("pdf-ro-no-year");
    expect(all.find((s) => /store number/.test(s.expected.description))?.id).toBe("csv-ro-comma-digits-before-amount");
    expect(all.find((s) => s.expected.parser === "refused")?.id).toBe("csv-en-currency-in-preamble");
    expect(all.every((s) => s.expected.knownGap === null)).toBe(true);
    expect(all.every((s) => s.answer !== null)).toBe(true);
  });

  it("use invented IBANs and card numbers only", async () => {
    for (const statement of generateAll()) {
      const text =
        statement.kind === "csv" ? new TextDecoder().decode(statement.bytes) : (await extractPdfText(statement.bytes)).flat().join("\n");
      const ibans = text.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/g) ?? [];
      expect(ibans.every((iban) => iban.startsWith("RO00FAKE")), statement.id).toBe(true);
      // Runs of 12 or more digits, or card-style groups, are only the well-known test card number.
      const cards = text.match(/\b\d{4}(?: \d{4}){2,4}\b|\b\d{12,}\b/g) ?? [];
      expect(cards.every((card) => card === "4111 1111 1111 1111"), statement.id).toBe(true);
    }
  });

  it("are claimed by the generic CSV parser, or not, as each file says", async () => {
    for (const statement of await statements()) {
      const prepared = await prepareStatement(statement);
      expect(prepared.parsing.status, statement.id).toBe(statement.expected.parser);
    }
  });

  it("read as numbered text the way an upload does, PDF tables keeping their columns", async () => {
    const card = (await statements()).find((s) => s.id === "pdf-en-two-pages")!;
    const { numbered } = await prepareStatement(card);

    expect(numbered.text).toContain("--- page 2 ---");
    expect(numbered.lines.some((line) => line.split("\t").length === 4 && line.startsWith("2026-09-01"))).toBe(true);
    // The IBAN in the heading is masked before the model would see it.
    expect(numbered.text).not.toContain("RO00FAKE0000000000000003");
    expect(numbered.text).toContain("…0003");
  });
});

describe("the dry run", () => {
  it("runs every statement through the real reader code with the stand-in model, and every one passes", async () => {
    // No network, whatever happens.
    const fetchSpy = vi.fn(() => {
      throw new Error("The dry run must not make a network call.");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const t = terminal();

    const code = await main(["--dry-run"], {}, t.io);

    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(t.providersCreated).toEqual([]);
    expect(t.asked).toEqual([]);

    const raw = JSON.parse(t.written.at(-1)!.content) as { meta: { dryRun: boolean }; results: StatementResult[] };
    expect(raw.meta.dryRun).toBe(true);
    expect(t.written[0].fileName.startsWith("dry-run-statements-fake-gpt-5.6-luna-none-")).toBe(true);

    const failed = raw.results.filter((result) => result.outcome !== "ok");
    expect(failed.map((result) => [result.id, result.detail])).toEqual([]);
    expect(raw.results.some((result) => result.id === "pdf-ro-no-year")).toBe(true);
    expect(raw.results.some((result) => result.id === "csv-ro-comma-digits-before-amount")).toBe(true);
    expect(raw.results.some((result) => result.id === "csv-en-currency-in-preamble" && result.mode === "read")).toBe(true);
    for (const result of raw.results) {
      expect(result.perfect, `${result.id} ${result.mode}`).toBe(true);
      expect(result.matchedRows, result.id).toBe(result.mode === "read" ? result.expectedRows : 0);
      expect(result.costMicros).toBeGreaterThan(0);
    }
  });

  it("prints a Markdown table labelled as fake output, with the aim next to the costs", async () => {
    const t = terminal();
    await main(["--dry-run", "--only", "csv-en-iso-signed,pdf-ro-no-year"], {}, t.io);
    const report = t.out.join("\n");

    expect(report).toContain("FAKE PROVIDER OUTPUT, NOT RESULTS");
    expect(report).toContain("| Mode | Statements OK | Rows exactly right |");
    expect(report).toMatch(/\| read \(verified\) \| 2\/2 \(100\.0%\) \| 22\/22 \(100\.0%\) \|/);
    expect(report).not.toContain("known gap");
    expect(report).toContain("$0.0100");
    expect(report).toContain("Estimated cost $");
  });

  it("still labels a statement that is marked as a known gap of the reader", () => {
    const failed: StatementResult = {
      id: "gap-example", kind: "csv", mode: "read", outcome: "unverified", detail: "date_unreadable (row 1)", knownGap: true,
      expectedRows: 3, matchedRows: 0, extraRows: 0, categoryScored: 0, categoryCorrect: 0, categorySubtypeCorrect: 0,
      perfect: false, warnings: 0, usage: null, costMicros: 0, ms: 0, answer: null,
    };

    const report = renderMarkdown({
      meta: { provider: "fake", model: "m", effort: "none", dryRun: true, at: "2026-10-30T00:00:00Z" },
      results: [failed],
      skipped: [],
      estimate: null,
    });

    expect(report).toContain("unverified: date_unreadable (row 1) (known gap)");
    expect(report).toContain("**Known gap** `gap-example`");
  });

  it("needs no key and no model name", async () => {
    const t = terminal();

    expect(await main(["--dry-run", "--mode", "categorise", "--only", "csv-en-iso-signed"], {}, t.io)).toBe(0);
    expect(t.out.join("\n")).toContain("categorise (answered) | 1/1");
  });
});

describe("a live run", () => {
  it("refuses without OPENAI_API_KEY, before it loads anything or asks anything", async () => {
    const t = terminal();

    expect(await main(["--model", "gpt-5.6-luna"], { AI_PROVIDER: "openai" }, t.io)).toBe(1);

    expect(t.err.join("\n")).toContain("OPENAI_API_KEY is not set");
    expect(t.asked).toEqual([]);
    expect(t.providersCreated).toEqual([]);
  });

  it("needs a model, a priced model and a known provider", async () => {
    const env = { OPENAI_API_KEY: "sk-test-not-real" };

    const noModel = terminal();
    expect(await main([], env, noModel.io)).toBe(2);
    const unpriced = terminal();
    expect(await main(["--model", "gpt-nonexistent"], env, unpriced.io)).toBe(1);
    expect(unpriced.err.join("\n")).toContain("no price");
    const other = terminal();
    expect(await main(["--model", "x", "--provider", "anthropic"], env, other.io)).toBe(1);

    for (const t of [noModel, unpriced, other]) expect(t.providersCreated).toEqual([]);
  });

  it("prints the estimate, asks for the confirmation word, and makes no call on anything else", async () => {
    const t = terminal({ answer: "yes" });

    expect(await main(["--model", "gpt-5.6-luna", "--only", "csv-en-iso-signed"], { OPENAI_API_KEY: "sk-test-not-real" }, t.io)).toBe(1);

    expect(t.out.join("\n")).toMatch(/Estimated cost \$0\.\d{4}, at most \$0\.\d{4}/);
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]).toContain(`"${CONFIRMATION_WORD}"`);
    expect(t.out.join("\n")).toContain("Nothing was spent");
    expect(t.providersCreated).toEqual([]);
    expect(t.written).toEqual([]);
  });

  it("will not run where nobody can type the confirmation", async () => {
    const t = terminal({ interactive: false });

    expect(await main(["--model", "gpt-5.6-luna"], { OPENAI_API_KEY: "sk-test-not-real" }, t.io)).toBe(1);

    expect(t.asked).toEqual([]);
    expect(t.providersCreated).toEqual([]);
  });

  it("calls the provider once confirmed, passes the chosen effort, and prices the usage from the table", async () => {
    const fake = new FakeProvider();
    const [statement] = (await statements()).filter((s) => s.id === "csv-en-iso-signed");
    fake.willReturn(statement.answer, { inputTokens: 2000, outputTokens: 500, cachedInputTokens: 1000 }, "gpt-5.6-luna");
    const t = terminal({ answer: CONFIRMATION_WORD, provider: () => fake });

    const code = await main(["--model", "gpt-5.6-luna", "--effort", "low", "--mode", "read", "--only", "csv-en-iso-signed"], { OPENAI_API_KEY: "sk-test-not-real" }, t.io);

    expect(code).toBe(0);
    expect(t.providersCreated).toEqual(["openai"]);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ model: "gpt-5.6-luna", effort: "low", schemaName: "statement_reading" });
    // 1000 fresh input at $0.20, 1000 cached at $0.02 and 500 output at $1.20, per million: $0.00082.
    const report = t.out.join("\n");
    expect(report).not.toContain("FAKE PROVIDER");
    expect(report).toContain("| 2000 / 1000 / 500 | $0.0008 |");
    expect(t.written[0].fileName).toMatch(/^statements-openai-gpt-5\.6-luna-low-/);
    expect(t.out.join("\n")).not.toContain("sk-test-not-real");
    expect(t.written.every((file) => !file.content.includes("sk-test-not-real"))).toBe(true);
  });
});

describe("the arguments", () => {
  it("default to effort none and both modes, and reject what they don't know", () => {
    expect(parseCli(["--model", "m"])).toMatchObject({ ok: true, model: "m", effort: "none", modes: ["read", "categorise"], dryRun: false });
    expect(parseCli(["--model", "m", "--mode", "read", "--effort", "low"])).toMatchObject({ ok: true, modes: ["read"], effort: "low" });
    expect(parseCli(["--effort", "extreme"])).toMatchObject({ ok: false });
    expect(parseCli(["--mode", "sideways"])).toMatchObject({ ok: false });
    expect(parseCli(["--nonsense"])).toMatchObject({ ok: false });
  });
});

describe("scoring", () => {
  const row = (overrides: Partial<VerifiedRow> = {}): VerifiedRow => ({
    expenseDate: "2026-09-01",
    description: "Lidl Cluj",
    amount: 45.2,
    currency: "RON",
    direction: "debit",
    suggestion: { category: "groceries", subtype: null },
    ...overrides,
  });
  const expected = (overrides = {}) => ({
    date: "2026-09-01",
    amount: "45.20",
    currency: "RON",
    direction: "debit" as const,
    merchant: "Lidl Cluj",
    category: "groceries" as const,
    subtype: null,
    ...overrides,
  });

  it("matches a merchant when all its words are there and at most three more were added", () => {
    expect(merchantMatches("Lidl Cluj", "Lidl Cluj")).toBe(true);
    expect(merchantMatches("Lidl Cluj", "LIDL CLUJ NAPOCA")).toBe(true);
    expect(merchantMatches("Cărturești", "carturesti verde")).toBe(true);
    expect(merchantMatches("Lidl Cluj", "Lidl")).toBe(false);
    expect(merchantMatches("Lidl", "POS 4411 LIDL CLUJ RO")).toBe(false);
    expect(merchantMatches("Lidl", "Kaufland")).toBe(false);
  });

  it("counts a row right only when date, amount, currency, direction and merchant all agree", () => {
    expect(scoreReading([expected()], [row()])).toMatchObject({ matchedRows: 1, extraRows: 0, categoryScored: 1, categoryCorrect: 1 });
    expect(scoreReading([expected()], [row({ expenseDate: "2026-09-02" })]).matchedRows).toBe(0);
    expect(scoreReading([expected()], [row({ amount: 45.3 })]).matchedRows).toBe(0);
    expect(scoreReading([expected()], [row({ currency: "EUR" })]).matchedRows).toBe(0);
    expect(scoreReading([expected()], [row({ direction: "credit" })]).matchedRows).toBe(0);
    expect(scoreReading([expected()], [row({ description: "Kaufland" })]).matchedRows).toBe(0);
  });

  it("lets one reading row satisfy one expected row, and counts rows nobody expected", () => {
    const twice = scoreReading([expected(), expected()], [row()]);
    expect(twice).toMatchObject({ matchedRows: 1, extraRows: 0 });
    expect(scoreReading([expected()], [row(), row({ amount: 9.99 })])).toMatchObject({ matchedRows: 1, extraRows: 1 });
  });

  it("scores categories on money out only, and leaves out the merchants the merchant rule knows", () => {
    const score = scoreReading(
      [
        expected(),
        expected({ merchant: "Salariu", direction: "credit", category: "other", date: "2026-09-02" }),
        expected({ merchant: "OMV 1642 Satu Mare", category: "car", subtype: "car_fuel", date: "2026-09-03" }),
        expected({ merchant: "Rompetrol", category: "car", subtype: "car_fuel", date: "2026-09-04" }),
      ],
      [
        row({ suggestion: { category: "shopping", subtype: null } }),
        row({ description: "Salariu", direction: "credit", expenseDate: "2026-09-02", suggestion: null }),
        row({ description: "OMV 1642 Satu Mare", expenseDate: "2026-09-03", suggestion: null }),
        row({ description: "Rompetrol", expenseDate: "2026-09-04", suggestion: { category: "car", subtype: "car_repairs" } }),
      ],
    );

    expect(score).toMatchObject({ matchedRows: 4, categoryScored: 2, categoryCorrect: 1, categorySubtypeCorrect: 0 });
  });
});

describe("running", () => {
  async function prepared(id: string) {
    return prepareStatement((await statements()).find((s) => s.id === id)!);
  }

  it("scores a model that gets a category wrong, without failing the statement", async () => {
    const item = await prepared("csv-en-iso-signed");
    const answer: ReaderAnswer = structuredClone(item.statement.answer!);
    answer.k = answer.k.map((entry) => (entry.m === "Netflix" ? { ...entry, c: "shopping" as const } : entry));
    const fake = new FakeProvider().willReturn(answer);

    const { jobs } = planJobs([item], ["read"]);
    const [result] = await runJobs(jobs, { provider: fake, model: "fake-model", effort: "none", price: LUNA });

    expect(result).toMatchObject({ outcome: "ok", matchedRows: 14, categoryScored: 11, categoryCorrect: 10, perfect: false });
  });

  it("fails verification for an amount the statement doesn't have, as production would", async () => {
    const item = await prepared("csv-en-iso-signed");
    const answer: ReaderAnswer = structuredClone(item.statement.answer!);
    answer.r[0] = { ...answer.r[0], a: "-45.30" };

    const { jobs } = planJobs([item], ["read"]);
    const [result] = await runJobs(jobs, { provider: new FakeProvider().willReturn(answer), model: "fake-model", effort: "none", price: LUNA });

    expect(result).toMatchObject({ outcome: "unverified", detail: "amount_not_found (row 1)", matchedRows: 0 });
  });

  it("records a refused, a cut-off and a malformed answer as failures, with what the provider billed", async () => {
    const item = await prepared("csv-en-iso-signed");
    const { jobs } = planJobs([item, item, item], ["read"]);
    const usage = { inputTokens: 1000, outputTokens: 4000, cachedInputTokens: 0 };
    const fake = new FakeProvider().willFail("max_tokens", usage).willFail("refusal", null).willReturn({ nonsense: true }, usage);

    const results = await runJobs(jobs, { provider: fake, model: "fake-model", effort: "none", price: LUNA });

    expect(results.map((r) => [r.outcome, r.detail, r.costMicros])).toEqual([
      ["failed", "call max_tokens", 5000],
      ["failed", "call refusal", 0],
      ["failed", "call invalid_output", 5000],
    ]);
  });

  it("scores mode categorise against the parser's rows and leaves the merchant rule's out", async () => {
    const item = await prepared("csv-en-iso-signed");
    const { jobs, skipped } = planJobs([item], ["categorise"]);
    expect(skipped).toEqual([]);

    // The parser's debit descriptions, minus OMV, which the merchant rule knows.
    expect(jobs[0].input.split("\n")).toHaveLength(11);
    expect(jobs[0].input).not.toContain("OMV");
    const wrong = { k: (jobs[0].perfectAnswer as { k: { c: string; s: string | null }[] }).k.map((entry, index) => (index === 0 ? { c: "other", s: null } : entry)) };

    const [result] = await runJobs(jobs, { provider: new FakeProvider().willReturn(wrong), model: "fake-model", effort: "none", price: LUNA });

    expect(result).toMatchObject({ mode: "categorise", outcome: "ok", categoryScored: 11, categoryCorrect: 10, perfect: false });
  });

  it("says why a statement isn't run in mode categorise", async () => {
    const all = await Promise.all((await statements()).map(prepareStatement));
    const { skipped } = planJobs(all, ["categorise"]);

    const reasons = Object.fromEntries(skipped.map((s) => [s.statementId, s.reason]));
    expect(reasons["csv-en-currency-in-preamble"]).toContain("refuses it (unreadable_statement)");
    expect(reasons["pdf-en-two-pages"]).toContain("no parser reads this layout");
  });

  it("estimates the cost from the text before any call: three characters to the token, at the table's prices", async () => {
    const item = await prepared("csv-en-iso-signed");
    const { jobs } = planJobs([item], ["read"]);
    const inputTokens = estimateJobInputTokens(jobs[0]);
    const estimate = estimateCost(jobs, LUNA);

    expect(estimate.calls).toBe(1);
    expect(estimate.inputTokens).toBe(inputTokens);
    expect(estimate.worstOutputTokens).toBe(jobs[0].maxOutputTokens);
    expect(estimate.worstMicros).toBe(Math.ceil((inputTokens * 200_000 + jobs[0].maxOutputTokens * 1_200_000) / 1_000_000));
    expect(estimate.expectedMicros).toBeLessThan(estimate.worstMicros);
  });
});

describe("samples", () => {
  it("turns the text of a PDF statement back into a PDF, tabs as columns and a marker line as a page break", async () => {
    const pdf = pdfFromText("Extras de cont\nData\tDescriere\tSuma\n01.09.2026\tPlata Lidl\t-45,20\n=== page ===\nPagina 2\n");

    expect(await extractPdfText(pdf)).toEqual([["Extras de cont", "Data\tDescriere\tSuma", "01.09.2026\tPlata Lidl\t-45,20"], ["Pagina 2"]]);
  });

  it("loads a statement with an expected file and no answer file, which the dry run leaves out", async () => {
    const t = terminal();
    const samples = await loadStatements([path.join(process.cwd(), "src/lib/imports/ai/__eval__/samples")]);

    expect(samples.every((s) => s.answer === null)).toBe(true);
    expect(await main(["--dry-run", "--only", "csv-en-iso-signed"], {}, t.io)).toBe(0);
  });
});

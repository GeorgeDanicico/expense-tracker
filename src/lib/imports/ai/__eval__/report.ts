import { AIM_MICROS, type Effort, type Estimate, type Mode, type Skip, type StatementResult } from "@/lib/imports/ai/__eval__/harness";

/**
 * What the eval reports (docs/statement-import-plan.md, I19): a summary per mode and a line per
 * statement, as Markdown to paste into a PR, and the same numbers as data for the raw results file.
 */

export type RunMeta = {
  provider: string;
  model: string;
  effort: Effort;
  /** The provider was the offline stand-in: nothing here is a real result. */
  dryRun: boolean;
  /** ISO time of the run. */
  at: string;
};

export type ModeSummary = {
  mode: Mode;
  /** Statements the model was called for. */
  statements: number;
  /** Read: passed verification. Categorise: gave a usable answer. */
  passed: number;
  /** The same two numbers without the statements that are known gaps of the reader. */
  statementsWithoutGaps: number;
  passedWithoutGaps: number;
  rowsExpected: number;
  rowsMatched: number;
  rowsExtra: number;
  categoryScored: number;
  categoryCorrect: number;
  categorySubtypeCorrect: number;
  perfect: number;
  /** Per statement, averaged over the calls that reported usage. */
  averageInputTokens: number;
  averageCachedTokens: number;
  averageOutputTokens: number;
  totalMicros: number;
  averageMicros: number;
  highestMicros: number;
  highestId: string | null;
  /** Statements that cost more than the aim. */
  overAim: number;
};

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function summarise(results: readonly StatementResult[], mode: Mode): ModeSummary | null {
  const own = results.filter((result) => result.mode === mode);
  if (own.length === 0) return null;
  const withoutGaps = own.filter((result) => !result.knownGap);
  const billed = own.filter((result) => result.usage !== null);
  const average = (pick: (result: StatementResult) => number) => (billed.length === 0 ? 0 : Math.round(sum(billed.map(pick)) / billed.length));
  const highest = own.reduce((best, result) => (result.costMicros > best.costMicros ? result : best), own[0]);

  return {
    mode,
    statements: own.length,
    passed: own.filter((result) => result.outcome === "ok").length,
    statementsWithoutGaps: withoutGaps.length,
    passedWithoutGaps: withoutGaps.filter((result) => result.outcome === "ok").length,
    rowsExpected: sum(own.map((result) => result.expectedRows)),
    rowsMatched: sum(own.map((result) => result.matchedRows)),
    rowsExtra: sum(own.map((result) => result.extraRows)),
    categoryScored: sum(own.map((result) => result.categoryScored)),
    categoryCorrect: sum(own.map((result) => result.categoryCorrect)),
    categorySubtypeCorrect: sum(own.map((result) => result.categorySubtypeCorrect)),
    perfect: own.filter((result) => result.perfect).length,
    averageInputTokens: average((result) => result.usage?.inputTokens ?? 0),
    averageCachedTokens: average((result) => result.usage?.cachedInputTokens ?? 0),
    averageOutputTokens: average((result) => result.usage?.outputTokens ?? 0),
    totalMicros: sum(own.map((result) => result.costMicros)),
    averageMicros: Math.round(sum(own.map((result) => result.costMicros)) / own.length),
    highestMicros: highest.costMicros,
    highestId: highest.costMicros > 0 ? highest.id : null,
    overAim: own.filter((result) => result.costMicros > AIM_MICROS).length,
  };
}

/** A cost in dollars to a hundredth of a cent. */
export function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function share(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${part}/${whole} (${((100 * part) / whole).toFixed(1)}%)`;
}

const MODE_LABEL: Record<Mode, string> = { read: "read (verified)", categorise: "categorise (answered)" };

function tokens(result: Pick<StatementResult, "usage">): string {
  return result.usage ? `${result.usage.inputTokens} / ${result.usage.cachedInputTokens} / ${result.usage.outputTokens}` : "n/a";
}

export type Report = {
  meta: RunMeta;
  results: StatementResult[];
  skipped: Skip[];
  estimate: Estimate | null;
};

/** The Markdown report: a banner for a dry run, a summary per mode, a line per statement, and the notes. */
export function renderMarkdown(report: Report): string {
  const { meta, results, skipped } = report;
  const out: string[] = [];

  out.push(`### Statement reader eval: ${meta.provider} ${meta.model}, effort ${meta.effort}`);
  out.push("");
  if (meta.dryRun) {
    out.push(
      "> **FAKE PROVIDER OUTPUT, NOT RESULTS.** This is the offline `--dry-run`: the model is replaced by a stand-in that returns the expected answers, and its token counts are made up from the length of the text. It shows that the harness works. It says nothing about any model.",
    );
    out.push("");
  }
  out.push(`Run at ${meta.at}. ${new Set(results.map((result) => result.id)).size} statements; reasoning effort \`${meta.effort}\`; the aim is ${dollars(AIM_MICROS)} a statement.`);
  out.push("");

  out.push("| Mode | Statements OK | Rows exactly right | Category | Category and subtype | Tokens per statement (in / cached / out) | Average cost | Highest cost | Against the aim |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  const summaries = (["read", "categorise"] as const).map((mode) => summarise(results, mode)).filter((summary) => summary !== null);
  for (const s of summaries) {
    const rows = s.mode === "read" ? share(s.rowsMatched, s.rowsExpected) : "n/a";
    const cells = [
        MODE_LABEL[s.mode],
        share(s.passed, s.statements),
        rows,
        share(s.categoryCorrect, s.categoryScored),
        share(s.categorySubtypeCorrect, s.categoryScored),
        `${s.averageInputTokens} / ${s.averageCachedTokens} / ${s.averageOutputTokens}`,
        dollars(s.averageMicros),
        s.highestId ? `${dollars(s.highestMicros)} (${s.highestId})` : dollars(s.highestMicros),
        s.overAim === 0 ? `all within ${dollars(AIM_MICROS)}` : `${s.overAim} of ${s.statements} over ${dollars(AIM_MICROS)}`,
    ];
    out.push(`| ${cells.join(" | ")} |`);
  }
  out.push("");

  out.push("| Statement | Mode | Result | Rows right | Extra rows | Categories right | Tokens (in / cached / out) | Cost |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const result of results) {
    const label =
      result.outcome === "ok"
        ? `${result.perfect ? "ok, perfect" : "ok"}${result.dropped > 0 ? `, ${result.dropped} dropped` : ""}`
        : `${result.outcome}: ${result.detail ?? "no detail"}${result.knownGap ? " (known gap)" : ""}`;
    out.push(
      `| ${result.id} | ${result.mode} | ${label} | ${result.mode === "read" ? `${result.matchedRows}/${result.expectedRows}` : "n/a"} | ${
        result.mode === "read" && result.outcome === "ok" ? result.extraRows : "n/a"
      } | ${result.categoryScored === 0 ? "n/a" : `${result.categorySubtypeCorrect}/${result.categoryScored}`} | ${tokens(result)} | ${dollars(result.costMicros)} |`,
    );
  }
  out.push("");

  out.push("How to read this:");
  out.push("");
  out.push(
    "- **Statements OK**: in mode read, the statement passed code's verification against its text; in mode categorise, the model's answer had one category for each merchant. A statement that fails verification is refused in production, and its rows count as not right here.",
  );
  out.push(
    "- **Result**: \"ok\" is a statement that passed verification. A row that fails one of code's spot checks (its amount or date isn't on the lines it cites) is left out, not fatal, and counted as \"dropped\"; a statement is refused when none survive or more than half are dropped.",
  );
  out.push(
    "- **Rows exactly right**: expected rows (money in included) that were read with the same date, amount, currency and direction and a matching merchant, out of all expected rows. Merchant matching is defined in `score.ts`.",
  );
  out.push(
    "- **Category**: of the money-out rows read exactly right, how many got the expected category (and, in the next column, subtype). Merchants the database's merchant rule knows are left out, since the rule overrides the model.",
  );
  const gaps = results.filter((result) => result.knownGap && result.mode === "read");
  for (const result of gaps) {
    out.push(`- **Known gap** \`${result.id}\`: counted as failed. See its \`expected.json\`.`);
  }
  const read = summaries.find((summary) => summary.mode === "read");
  if (read && gaps.length > 0) {
    out.push(`- Without the known gaps, ${share(read.passedWithoutGaps, read.statementsWithoutGaps)} of the read statements passed verification.`);
  }
  // One line per reason, naming the statements it applies to (the reasons with a number in them are one each).
  const byReason = new Map<string, string[]>();
  for (const item of skipped) byReason.set(`${item.mode}: ${item.reason}`, [...(byReason.get(`${item.mode}: ${item.reason}`) ?? []), item.statementId]);
  for (const [reason, ids] of byReason) {
    const [mode, ...text] = reason.split(": ");
    out.push(`- Not run in mode ${mode} (${text.join(": ")}): ${ids.map((id) => `\`${id}\``).join(", ")}.`);
  }

  return `${out.join("\n")}\n`;
}

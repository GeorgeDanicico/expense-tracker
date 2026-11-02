import { describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import { logRequest } from "@/lib/http/request-log";
import { createRequestContext, runWithRequestContext } from "@/lib/log/request-context";
import { span } from "@/lib/log/span";
import { createTracedFetch } from "@/lib/log/traced-fetch";

/**
 * The overhead micro-benchmark (logging plan, L4): what spans and request lines cost per call. It
 * prints its numbers and checks nothing tight, so it runs only when asked:
 *
 * ```sh
 * LOG_BENCH=1 npx vitest run src/lib/log/overhead.test.ts
 * ```
 */

const RUNS = 10_000;
const SPANS_PER_REQUEST = 10;
const response = new Response(null, { status: 204 });

/** Microseconds per run of `fn`, after a warm-up of a tenth of the runs. */
async function perRun(fn: (index: number) => Promise<unknown> | unknown): Promise<number> {
  for (let index = 0; index < RUNS / 10; index += 1) await fn(index);
  logged.length = 0;
  const startedAt = performance.now();
  for (let index = 0; index < RUNS; index += 1) await fn(index);
  const elapsed = performance.now() - startedAt;
  logged.length = 0;
  return (elapsed * 1000) / RUNS;
}

describe.runIf(process.env.LOG_BENCH)("span and request line overhead", () => {
  it(`times ${RUNS} spans, traced fetches and request lines`, async () => {
    const noop = async () => undefined;
    const fetchNoop = createTracedFetch(async () => response);
    const url = "https://abcdefghijklmnop.supabase.co/rest/v1/expenses?select=*&user_id=eq.6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";

    const bareCall = await perRun(noop);
    let context = createRequestContext(undefined);
    const spanCall = await perRun((index) => {
      if (index % SPANS_PER_REQUEST === 0) context = createRequestContext(undefined);
      return runWithRequestContext(context, () => span("db.expenses.get", noop));
    });
    const bareFetch = await perRun(() => response);
    const tracedFetchCall = await perRun((index) => {
      if (index % SPANS_PER_REQUEST === 0) context = createRequestContext(undefined);
      return runWithRequestContext(context, () => fetchNoop(url));
    });
    const lineWithoutSpans = await perRun(() => logRequest(undefined, async () => response));
    const lineWithSpans = await perRun(() =>
      logRequest(undefined, async () => {
        for (let index = 0; index < SPANS_PER_REQUEST; index += 1) await fetchNoop(url);
        return response;
      }),
    );

    const rows = {
      "await of a no-op (baseline)": bareCall,
      "span() around a no-op": spanCall,
      "plain call returning a Response (baseline)": bareFetch,
      "traced fetch, inner fetch a no-op": tracedFetchCall,
      "request line, no spans": lineWithoutSpans,
      [`request line with ${SPANS_PER_REQUEST} traced fetches`]: lineWithSpans,
    };
    console.log(
      [
        `Overhead over ${RUNS} runs (µs per run, Node ${process.version}):`,
        ...Object.entries(rows).map(([name, us]) => `  ${name.padEnd(48)} ${us.toFixed(2)}`),
        `  L4's added cost per request with ${SPANS_PER_REQUEST} Supabase calls: ${((lineWithSpans - lineWithoutSpans) / 1000).toFixed(4)} ms`,
      ].join("\n"),
    );

    // A loose guard only: the plan expects well under 0.1 ms per request.
    expect((lineWithSpans - lineWithoutSpans) / 1000).toBeLessThan(1);
  });
});

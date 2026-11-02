import { describe, expect, it } from "vitest";

import { createRequestContext, runWithRequestContext, type RequestContext } from "@/lib/log/request-context";
import { MAX_SPANS, isDbSpan, recordSpan, span, spanNamePart, spanSummary } from "@/lib/log/span";

function context(): RequestContext {
  return createRequestContext(new Request("http://localhost/api/test"));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("span", () => {
  it("records the call's name and whole milliseconds, and returns its result", async () => {
    const request = context();

    const result = await runWithRequestContext(request, () => span("db.expenses.get", async () => {
      await wait(5);
      return 42;
    }));

    expect(result).toBe(42);
    expect(request.spans).toEqual([{ name: "db.expenses.get", ms: expect.any(Number) }]);
    expect(Number.isInteger(request.spans[0].ms)).toBe(true);
    expect(request.spans[0].ms).toBeGreaterThanOrEqual(4);
  });

  it("runs a synchronous function too", async () => {
    const request = context();
    await expect(runWithRequestContext(request, () => span("import.parse_pdf", () => "text"))).resolves.toBe("text");
    expect(request.spans).toEqual([{ name: "import.parse_pdf", ms: expect.any(Number) }]);
  });

  it("rethrows the very error the call threw, and marks the span", async () => {
    const request = context();
    const error = new Error("boom");

    await expect(runWithRequestContext(request, () => span("ai.openai.gpt", async () => {
      throw error;
    }))).rejects.toBe(error);
    await expect(runWithRequestContext(request, () => span("sync.throw", () => {
      throw "plain";
    }))).rejects.toBe("plain");

    expect(request.spans).toEqual([
      { name: "ai.openai.gpt", ms: expect.any(Number), error: true },
      { name: "sync.throw", ms: expect.any(Number), error: true },
    ]);
  });

  it("adds the caller's fields", async () => {
    const request = context();
    await runWithRequestContext(request, () => span("push.send", async () => undefined, { deviceId: "device-1" }));
    expect(request.spans).toEqual([{ name: "push.send", ms: expect.any(Number), deviceId: "device-1" }]);
  });

  it("just runs the function outside a request", async () => {
    await expect(span("db.expenses.get", async () => "value")).resolves.toBe("value");
    const error = new Error("outside");
    await expect(span("db.expenses.get", async () => {
      throw error;
    })).rejects.toBe(error);
    expect(() => recordSpan("db.expenses.get", 3)).not.toThrow();
  });

  it("records on the request it started in, through awaits and parallel calls", async () => {
    const request = context();
    await runWithRequestContext(request, async () => {
      await Promise.all([span("db.a.get", () => wait(1)), span("db.b.get", () => wait(1))]);
      await span("rpc.c", () => wait(1));
    });
    expect(request.spans.map((entry) => entry.name).sort()).toEqual(["db.a.get", "db.b.get", "rpc.c"]);
  });
});

describe("the span list's limits", () => {
  it("keeps every call while there are at most 30", () => {
    const request = context();
    for (let index = 0; index < MAX_SPANS; index += 1) recordSpan("db.expenses.get", 1, {}, request);
    expect(request.spans).toHaveLength(30);
    expect(request.spans.every((entry) => entry.count === undefined)).toBe(true);
  });

  it("merges calls of one name past 30, summing ms and keeping the order of first calls", () => {
    const request = context();
    for (let index = 0; index < 40; index += 1) recordSpan(index % 2 === 0 ? "db.expenses.get" : "rpc.move_todo", 2, {}, request);
    recordSpan("auth.user", 7, {}, request);

    expect(request.spans).toEqual([
      { name: "db.expenses.get", ms: 40, count: 20 },
      { name: "rpc.move_todo", ms: 40, count: 20 },
      { name: "auth.user", ms: 7 },
    ]);
  });

  it("keeps error on a merged entry and drops the per-call fields", () => {
    const request = context();
    for (let index = 0; index < MAX_SPANS; index += 1) recordSpan("push.send", 1, { deviceId: `d${index}` }, request);
    recordSpan("push.send", 1, { error: true, status: 410, deviceId: "d30" }, request);

    expect(request.spans).toEqual([{ name: "push.send", ms: 31, count: 31, error: true }]);
  });

  it("puts calls past 30 distinct names into one other entry, never more than 30 entries", () => {
    const request = context();
    for (let index = 0; index < 45; index += 1) recordSpan(`db.table_${index}.get`, 1, {}, request);
    recordSpan("db.table_0.get", 1, {}, request);

    expect(request.spans).toHaveLength(MAX_SPANS);
    expect(request.spans.slice(0, 29).map((entry) => entry.name)).toEqual(Array.from({ length: 29 }, (_, index) => `db.table_${index}.get`));
    expect(request.spans[0]).toEqual({ name: "db.table_0.get", ms: 2, count: 2 });
    expect(request.spans[29]).toEqual({ name: "other", ms: 16, count: 16 });
  });

  it("still counts every call in the totals", () => {
    const request = context();
    for (let index = 0; index < 100; index += 1) recordSpan(`db.table_${index}.get`, 1.4, {}, request);
    recordSpan("push.send", 900, {}, request);

    expect(spanSummary(request, true)).toEqual({ dbMs: 140, dbCalls: 100, slowestSpan: { name: "push.send", ms: 900 } });
  });
});

describe("spanSummary", () => {
  it("adds up the Supabase spans only, and names the slowest single call when slow", () => {
    const request = context();
    recordSpan("db.expenses.get", 10.4, {}, request);
    recordSpan("rpc.move_todo", 20.4, {}, request);
    recordSpan("auth.user", 5, {}, request);
    recordSpan("storage.avatars", 5, {}, request);
    recordSpan("supabase.other", 50, {}, request);
    recordSpan("ai.openai.gpt-5", 700, {}, request);

    expect(spanSummary(request, false)).toEqual({ dbMs: 41, dbCalls: 4 });
    expect(spanSummary(request, true)).toEqual({ dbMs: 41, dbCalls: 4, slowestSpan: { name: "ai.openai.gpt-5", ms: 700 } });
  });

  it("is zero for a request without spans, with no slowest span", () => {
    expect(spanSummary(context(), true)).toEqual({ dbMs: 0, dbCalls: 0 });
  });

  it("knows which spans are Supabase calls", () => {
    expect(["db.x.get", "rpc.f", "auth.token", "storage.avatars"].every(isDbSpan)).toBe(true);
    expect(["supabase.other", "push.send", "ai.openai.m", "import.parse_pdf", "other"].some(isDbSpan)).toBe(false);
  });
});

describe("spanNamePart", () => {
  it("clips a run the logger would redact, and replaces unsafe characters", () => {
    expect(spanNamePart("create_net_worth_item_with_valuation")).toBe("create_net_worth_item_with_val…");
    expect(spanNamePart("gpt-5.1-mini")).toBe("gpt-5.1-mini");
    expect(spanNamePart("a b/c?d=e")).toBe("a_b_c_d_e");
  });
});

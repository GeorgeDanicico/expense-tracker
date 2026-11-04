import type { ScopedMutator } from "swr";
import { describe, expect, it, vi } from "vitest";

import type { InvestmentApi, InvestmentOrderInput } from "@/components/investments/investment-api";
import { investmentWrites, refreshInvestmentViews } from "@/components/investments/use-investment-writes";

const ORDER: InvestmentOrderInput = {
  brokerId: "xtb", instrument: "VWCE.DE", currency: "EUR", side: "sell",
  amount: "1300.00", quantity: "10", unitPrice: "130.00", executedAt: "2026-09-02T09:31:00.000Z",
};

/** A global `mutate` that records what it was asked, as keys or as the filter's matches. */
function recorder(cached = ["/api/investments", "/api/net-worth", "/api/investment-transactions?accountId=a&instrument=VWCE.DE&currency=EUR", "/api/investment-transactions?accountId=a&member=m-2", "/api/expenses?month=2026-10"]) {
  const calls: { target: string[]; args: unknown[] }[] = [];
  const mutate = vi.fn(async (key: unknown, ...args: unknown[]) => {
    const target = typeof key === "function" ? cached.filter((candidate) => (key as (value: string) => boolean)(candidate)) : [key as string];
    calls.push({ target, args });
  });
  return { mutate: mutate as unknown as ScopedMutator, calls };
}

function api(overrides: Partial<InvestmentApi> = {}): InvestmentApi {
  return { createOrder: vi.fn(async () => undefined), removeOrder: vi.fn(async () => undefined), ...overrides };
}

describe("refreshInvestmentViews", () => {
  it("reads the overview, net worth and every order list again, and nothing else", async () => {
    const swr = recorder();
    await refreshInvestmentViews(swr.mutate);
    expect(swr.calls.flatMap((call) => call.target)).toEqual([
      "/api/investments",
      "/api/net-worth",
      "/api/investment-transactions?accountId=a&instrument=VWCE.DE&currency=EUR",
      "/api/investment-transactions?accountId=a&member=m-2",
    ]);
  });
});

describe("investment order writes", () => {
  it("sends the order, then refreshes; it never writes to the cache itself (no optimism)", async () => {
    const swr = recorder();
    const order: string[] = [];
    const writes = investmentWrites(api({ createOrder: vi.fn(async () => { order.push("sent"); }) }), swr.mutate);

    await writes.createOrder(ORDER);

    expect(order).toEqual(["sent"]);
    // Every call is a refresh: none carries data.
    expect(swr.calls.every((call) => call.args.length === 0)).toBe(true);
    expect(swr.calls.length).toBeGreaterThan(0);
  });

  it("waits for the server: nothing is refreshed while the order is in flight", async () => {
    const swr = recorder();
    let answer!: () => void;
    const writes = investmentWrites(api({ createOrder: () => new Promise<void>((resolve) => { answer = resolve; }) }), swr.mutate);

    const saving = writes.createOrder(ORDER);
    await Promise.resolve();
    expect(swr.calls).toEqual([]);
    answer();
    await saving;
    expect(swr.calls.length).toBeGreaterThan(0);
  });

  it("throws the server's refusal for the form to show, and refreshes nothing", async () => {
    const swr = recorder();
    const refusal = new Error("You hold 4 units at that time.");
    const writes = investmentWrites(api({ createOrder: vi.fn(async () => { throw refusal; }), removeOrder: vi.fn(async () => { throw refusal; }) }), swr.mutate);

    await expect(writes.createOrder(ORDER)).rejects.toBe(refusal);
    await expect(writes.removeOrder("tx-1")).rejects.toBe(refusal);
    expect(swr.calls).toEqual([]);
  });

  it("removes an order by id, then refreshes", async () => {
    const swr = recorder();
    const removeOrder = vi.fn(async () => undefined);
    await investmentWrites(api({ removeOrder }), swr.mutate).removeOrder("tx-1");
    expect(removeOrder).toHaveBeenCalledWith("tx-1");
    expect(swr.calls.flatMap((call) => call.target)).toContain("/api/investments");
  });
});

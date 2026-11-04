import type { Cache, ScopedMutator } from "swr";
import { describe, expect, it, vi } from "vitest";

import type { NetWorthApi } from "@/components/net-worth/net-worth-api";
import { withValuation } from "@/components/net-worth/net-worth-cache";
import { netWorthWrites } from "@/components/net-worth/use-net-worth-writes";
import type { NetWorthEntry, NetWorthOverview } from "@/lib/net-worth/types";

const KEY = "/api/net-worth";

const savings: NetWorthEntry = {
  id: "manual:item-1", source: "manual", kind: "asset", category: "cash", name: "Savings", reference: null,
  itemId: "item-1", currency: "EUR", purchaseAmount: null, currentValue: "4000.00", comparison: null,
  valuedOn: "2026-10-01", status: "manual",
};
const loan: NetWorthEntry = { ...savings, id: "manual:item-2", itemId: "item-2", kind: "liability", category: "debt", name: "Loan", currentValue: null, valuedOn: null, status: "missing_value" };
const overview: NetWorthOverview = { entries: [savings, loan], totalsByCurrency: [], attention: [], calculationIssues: [] };

/** An SWR cache with the global mutate's semantics for what these writes use: a key or a filter, data or no data. */
function swrCache(initial: Record<string, unknown>) {
  const store = new Map<string, { data?: unknown }>(Object.entries(initial).map(([key, data]) => [key, { data }]));
  const revalidated: string[] = [];
  const mutate = vi.fn(async (...args: [key: unknown, data?: unknown, options?: { revalidate?: boolean }]) => {
    const [key, data, options] = args;
    const keys = typeof key === "function" ? [...store.keys()].filter((cached) => (key as (value: string) => boolean)(cached)) : [key as string];
    for (const cached of keys) {
      if (args.length > 1) store.set(cached, { data });
      if (args.length === 1 || options?.revalidate !== false) revalidated.push(cached);
    }
  });
  return { mutate: mutate as unknown as ScopedMutator, cache: store as unknown as Cache, data: (key: string) => store.get(key)?.data, revalidated };
}

function deferred() {
  let answer!: () => void;
  let refuse!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  return { promise, answer, refuse };
}

function api(overrides: Partial<NetWorthApi> = {}): NetWorthApi {
  return { createItem: vi.fn(async () => undefined), updateItem: vi.fn(async () => undefined), addValuation: vi.fn(async () => undefined), ...overrides };
}

describe("withValuation", () => {
  it("shows the new value and date on the item's row and marks it a manual value", () => {
    const next = withValuation(overview, "item-2", "950.00", "2026-11-04");
    expect(next?.entries[1]).toMatchObject({ currentValue: "950.00", valuedOn: "2026-11-04", status: "manual" });
    expect(next?.entries[0]).toBe(savings);
  });

  it("leaves the overview alone for a value dated before the latest observation, or an unknown item", () => {
    expect(withValuation(overview, "item-1", "3000.00", "2026-09-01")).toBe(overview);
    expect(withValuation(overview, "nope", "1.00", "2026-11-04")).toBe(overview);
    expect(withValuation(undefined, "item-1", "1.00", "2026-11-04")).toBeUndefined();
  });

  it("replaces the observation when the date is the same", () => {
    expect(withValuation(overview, "item-1", "4100.00", "2026-10-01")?.entries[0]).toMatchObject({ currentValue: "4100.00", valuedOn: "2026-10-01" });
  });
});

describe("an optimistic value", () => {
  it("shows at once, before the server answers, then refetches every balance sheet", async () => {
    const swr = swrCache({ [KEY]: overview, [`${KEY}?member=all`]: { members: [] }, "/api/expenses?month=2026-10": {} });
    const server = deferred();
    const writes = netWorthWrites(api({ addValuation: vi.fn(() => server.promise) }), swr);

    const saving = writes.addValuation("item-1", { value: "4200.00", valuedOn: "2026-11-04" });
    await vi.waitFor(() => expect((swr.data(KEY) as NetWorthOverview).entries[0].currentValue).toBe("4200.00"));
    expect(swr.revalidated).toEqual([]);

    server.answer();
    await saving;
    expect(swr.revalidated).toEqual([KEY, `${KEY}?member=all`]);
  });

  it("rolls the sheet back and throws when the server refuses", async () => {
    const swr = swrCache({ [KEY]: overview });
    const refusal = new Error("Couldn't save. Try again.");
    const writes = netWorthWrites(api({ addValuation: vi.fn(async () => { throw refusal; }) }), swr);

    await expect(writes.addValuation("item-1", { value: "4200.00", valuedOn: "2026-11-04" })).rejects.toBe(refusal);

    expect(swr.data(KEY)).toBe(overview);
    expect(swr.revalidated).toEqual([]);
  });

  it("sends the value for the item as typed", async () => {
    const swr = swrCache({ [KEY]: overview });
    const addValuation = vi.fn(async () => undefined);
    await netWorthWrites(api({ addValuation }), swr).addValuation("item-1", { value: "4200", valuedOn: "2026-11-04" });
    expect(addValuation).toHaveBeenCalledWith("item-1", { value: "4200", valuedOn: "2026-11-04" });
  });
});

describe("item writes", () => {
  it("wait for the server before the sheet is refetched, and leave the cache alone on failure", async () => {
    const swr = swrCache({ [KEY]: overview });
    const server = deferred();
    const writes = netWorthWrites(api({ updateItem: vi.fn(() => server.promise) }), swr);

    const archiving = writes.updateItem("item-1", { archived: true });
    await Promise.resolve();
    expect(swr.data(KEY)).toBe(overview);
    expect(swr.revalidated).toEqual([]);
    server.answer();
    await archiving;
    expect(swr.revalidated).toEqual([KEY]);

    const failing = swrCache({ [KEY]: overview });
    const refusal = new Error("nope");
    await expect(netWorthWrites(api({ createItem: vi.fn(async () => { throw refusal; }) }), failing).createItem({
      name: "Car", kind: "asset", category: "custom", currency: "EUR", purchaseAmount: null, value: "9000", valuedOn: "2026-11-04",
    })).rejects.toBe(refusal);
    expect(failing.revalidated).toEqual([]);
  });
});

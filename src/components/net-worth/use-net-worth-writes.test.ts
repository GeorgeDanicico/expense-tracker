import type { ScopedMutator } from "swr";
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

/** A global `mutate` that records which cached keys a key or a filter reached, to see what a write refetches. */
function swrCache(keys: string[]) {
  const revalidated: string[] = [];
  const mutate = vi.fn(async (key: unknown) => {
    revalidated.push(...(typeof key === "function" ? keys.filter((cached) => (key as (value: string) => boolean)(cached)) : [key as string]));
  });
  return { mutate: mutate as unknown as ScopedMutator, revalidated };
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

describe("item writes", () => {
  it("wait for the server before the sheet is refetched, and leave the cache alone on failure", async () => {
    const swr = swrCache([KEY]);
    const server = deferred();
    const writes = netWorthWrites(api({ updateItem: vi.fn(() => server.promise) }), swr.mutate);

    const archiving = writes.updateItem("item-1", { archived: true });
    await Promise.resolve();
    expect(swr.revalidated).toEqual([]);
    server.answer();
    await archiving;
    expect(swr.revalidated).toEqual([KEY]);

    const failing = swrCache([KEY]);
    const refusal = new Error("nope");
    await expect(netWorthWrites(api({ createItem: vi.fn(async () => { throw refusal; }) }), failing.mutate).createItem({
      name: "Car", kind: "asset", category: "custom", currency: "EUR", purchaseAmount: null, value: "9000", valuedOn: "2026-11-04",
    })).rejects.toBe(refusal);
    expect(failing.revalidated).toEqual([]);
  });
});

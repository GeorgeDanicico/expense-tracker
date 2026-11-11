// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import useSWR, { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NetWorthApiProvider, type NetWorthApi } from "@/components/net-worth/net-worth-api";
import { useNetWorthWrites } from "@/components/net-worth/use-net-worth-writes";
import { ApiError } from "@/lib/api/client";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
import type { NetWorthEntry, NetWorthOverview } from "@/lib/net-worth/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const savings: NetWorthEntry = {
  id: "manual:item-1", source: "manual", kind: "asset", category: "cash", name: "Savings", reference: null,
  itemId: "item-1", currency: "EUR", purchaseAmount: null, currentValue: "4000.00", comparison: null,
  valuedOn: "2026-10-01", status: "manual",
};
const before: NetWorthOverview = { entries: [savings], totalsByCurrency: [], attention: [], calculationIssues: [] };
const fromServer: NetWorthOverview = { ...before, entries: [{ ...savings, currentValue: "4200.00", valuedOn: "2026-11-04", comparison: { label: "since Oct 1", amount: "200.00", meaning: "balance_change", tone: "positive" } }] };

const handles: { writes?: ReturnType<typeof useNetWorthWrites> } = {};

/** The balance sheet as the Net worth page reads it, with the writes the sheet calls. */
function Sheet() {
  const { data } = useSWR<NetWorthOverview>(NET_WORTH_API_KEY);
  const writes = useNetWorthWrites();
  useEffect(() => {
    handles.writes = writes;
  }, [writes]);
  return <p data-testid="value">{data?.entries[0].currentValue ?? "none"}</p>;
}

let cleanup: (() => void) | null = null;

/** Mounts the sheet on a cache that already holds `before`, as it does once the server's copy has been written into it. */
async function mount(api: Partial<NetWorthApi>) {
  const fetcher = vi.fn(async () => fromServer);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const cache = new Map([[NET_WORTH_API_KEY, { data: before }]]);
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => cache as never, fetcher, revalidateOnMount: false, revalidateIfStale: false, revalidateOnFocus: false, dedupingInterval: 0 }}>
        <NetWorthApiProvider api={{ createItem: vi.fn(), updateItem: vi.fn(), addValuation: vi.fn(), ...api }}>
          <Sheet />
        </NetWorthApiProvider>
      </SWRConfig>,
    );
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const shown = () => container.querySelector('[data-testid="value"]')?.textContent;
  return { fetcher, shown };
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  handles.writes = undefined;
});

function deferred() {
  let answer!: () => void;
  let refuse!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  return { promise, answer, refuse };
}

describe("an optimistic net-worth value", () => {
  it("shows in the sheet before the server answers, then the sheet is read again", async () => {
    const server = deferred();
    const { fetcher, shown } = await mount({ addValuation: vi.fn(() => server.promise) });
    expect(shown()).toBe("4000.00");

    let saving!: Promise<void>;
    await act(async () => {
      saving = handles.writes!.addValuation("item-1", { value: "4200.00", valuedOn: "2026-11-04" });
    });
    expect(shown()).toBe("4200.00");
    expect(fetcher).not.toHaveBeenCalled();

    server.answer();
    await act(async () => {
      await saving;
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("4200.00");
  });

  it.each([
    ["a 422, a value the server refuses", 422],
    ["a 500, a server that failed", 500],
  ])("goes back to what the sheet held and throws on %s", async (_name, status) => {
    const server = deferred();
    const { fetcher, shown } = await mount({ addValuation: vi.fn(() => server.promise) });
    const refusal = new ApiError("The value could not be saved.", status);

    let outcome!: Promise<unknown>;
    await act(async () => {
      outcome = handles.writes!.addValuation("item-1", { value: "4200.00", valuedOn: "2026-11-04" }).catch((caught: unknown) => caught);
    });
    expect(shown()).toBe("4200.00");

    server.refuse(refusal);
    await act(async () => {
      expect(await outcome).toBe(refusal);
    });
    expect(shown()).toBe("4000.00");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("changes nothing while an item the sheet doesn't hold is saved", async () => {
    const server = deferred();
    const { shown } = await mount({ addValuation: vi.fn(() => server.promise) });
    await act(async () => {
      void handles.writes!.addValuation("other-item", { value: "1.00", valuedOn: "2026-11-04" });
    });
    expect(shown()).toBe("4000.00");
    server.answer();
  });
});

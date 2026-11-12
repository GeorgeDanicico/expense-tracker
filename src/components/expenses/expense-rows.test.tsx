// @vitest-environment happy-dom
import { ChakraProvider } from "@chakra-ui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpenseRows, type ExpenseRowActions } from "@/components/expenses/expense-rows";
import { ledgerSystem } from "@/components/ui/theme";
import type { ListedExpense } from "@/lib/expenses/types";
import { mountForAxe } from "@/test/axe";

// Each row draws one category tile, so the tiles drawn are the rows rendered.
const drawn = vi.hoisted(() => ({ tiles: 0 }));
vi.mock("@/components/expenses/category-visual", () => ({
  CategoryTile: () => {
    drawn.tiles += 1;
    return null;
  },
}));

const expense = (id: string): ListedExpense => ({ id, description: `Expense ${id}`, amount: 5, category: "groceries", subtype: null, expenseDate: "2026-11-03", notes: null });
const NOW = new Date("2026-11-04T09:00:00Z");

describe("ExpenseRows keyboard", () => {
  let unmount: (() => Promise<void>) | undefined;
  afterEach(async () => { await unmount?.(); });

  async function setUp() {
    const remove = vi.fn();
    const mounted = await mountForAxe(
      <ExpenseRows expenses={[expense("a"), expense("b")]} currency="EUR" now={NOW} actions={{ edit: vi.fn(), remove, hidden: new Set() }} />,
    );
    unmount = mounted.unmount;
    const rows = [...mounted.container.querySelectorAll<HTMLElement>("[data-expense-row]")];
    const press = (target: Element, key: string) => act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    return { remove, rows, press, container: mounted.container };
  }

  it("rows are not tab stops: the row's menu button is the way in", async () => {
    const { rows } = await setUp();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.getAttribute("tabindex")).toBe("-1");
  });

  it("Delete and Backspace delete the focused row and focus its neighbour", async () => {
    const { remove, rows, press } = await setUp();
    await press(rows[0], "Delete");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0].id).toBe("a");
    expect(document.activeElement).toBe(rows[1]);
    await press(rows[1], "Backspace");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls[1][0].id).toBe("b");
  });

  it("works from the row's own button, and not while typing in a field", async () => {
    const { remove, rows, press } = await setUp();
    await press(rows[0].querySelector("button")!, "Backspace");
    expect(remove).toHaveBeenCalledTimes(1);
    const input = document.createElement("input");
    rows[0].appendChild(input);
    await press(input, "Backspace");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("ExpenseRows renders", () => {
  it("only the rows that changed, so a few hundred rows don't all draw again on each key in the search or tap on Filters", async () => {
    const [a, b, c] = [expense("a"), expense("b"), expense("c")];
    const edit = vi.fn();
    const remove = vi.fn();
    const actionsWith = (hidden: string[]): ExpenseRowActions => ({ edit, remove, hidden: new Set(hidden) });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const show = (expenses: ListedExpense[], actions: ExpenseRowActions) =>
      act(async () => root.render(<ChakraProvider value={ledgerSystem}><ExpenseRows expenses={expenses} currency="EUR" now={NOW} actions={actions} /></ChakraProvider>));

    drawn.tiles = 0;
    await show([a, b, c], actionsWith([]));
    expect(drawn.tiles).toBe(3);

    // The parent rendering again with a new `actions` object (as the Expenses page does every time): no row draws again.
    drawn.tiles = 0;
    await show([a, b, c], actionsWith([]));
    expect(drawn.tiles).toBe(0);

    // A delete waiting for Undo hides one row: only that row's item changes.
    await show([a, b, c], actionsWith(["b"]));
    expect(drawn.tiles).toBe(1);

    // A filter that drops a row draws none of the rows that stay.
    drawn.tiles = 0;
    await show([a, c], actionsWith(["b"]));
    expect(drawn.tiles).toBe(0);

    await act(async () => root.unmount());
    container.remove();
  });
});

describe("ExpenseRows dimming", () => {
  const many = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => expense(`${prefix}${index}`));
  const list = (container: Element) => container.querySelector("ul")?.parentElement?.parentElement as HTMLElement;

  it("doesn't dim the first rows of a list that is drawing for the first time (the server's HTML and hydration)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    // Every change of the list's `aria-busy`, across the commit of the first 30 rows and the one with the whole month.
    const busy: string[] = [];
    const observer = new MutationObserver((records) => busy.push(...records.filter((record) => record.attributeName === "aria-busy").map((record) => record.target.nodeName)));
    observer.observe(container, { subtree: true, attributes: true });
    await act(async () => root.render(<ChakraProvider value={ledgerSystem}><ExpenseRows expenses={many(80, "a")} currency="EUR" now={NOW} /></ChakraProvider>));
    expect(container.querySelectorAll("li")).toHaveLength(80);
    expect(busy).toEqual([]);
    expect(list(container).style.opacity).toBe("");
    observer.disconnect();
    await act(async () => root.unmount());
    container.remove();
  });

  it("dims the old rows when a later change (another month, a search) leaves them behind, and stops once the new rows are in", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const show = (expenses: ListedExpense[]) =>
      act(async () => root.render(<ChakraProvider value={ledgerSystem}><ExpenseRows expenses={expenses} currency="EUR" now={NOW} /></ChakraProvider>));
    await show(many(80, "a"));
    // The new list is first drawn with the old rows (dimmed and busy), then with the new ones.
    const changes: Array<string | null> = [];
    const observer = new MutationObserver((records) => changes.push(...records.filter((record) => record.attributeName === "aria-busy").map((record) => record.oldValue)));
    observer.observe(container, { subtree: true, attributes: true, attributeOldValue: true });
    await show(many(60, "b"));
    observer.disconnect();
    expect(changes).toEqual([null, "true"]);
    expect(list(container).getAttribute("aria-busy")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(60);
    await act(async () => root.unmount());
    container.remove();
  });
});

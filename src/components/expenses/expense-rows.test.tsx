// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpenseRows } from "@/components/expenses/expense-rows";
import type { ListedExpense } from "@/lib/expenses/types";
import { mountForAxe } from "@/test/axe";

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

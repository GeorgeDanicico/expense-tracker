import type { Expense } from "@/lib/expenses/types";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { InvestmentTransaction } from "@/lib/investments/types";
import type { NetWorthManualItemSource, NetWorthValuation } from "@/lib/net-worth/types";

/** Test fixtures with readable defaults; override only what a test is about. */

export function anExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-1",
    description: "Groceries",
    amount: 10,
    category: "groceries",
    subtype: null,
    expenseDate: "2024-02-01",
    notes: null,
    ...overrides,
  };
}

export function aTab(overrides: Partial<ExpenseTab> = {}): ExpenseTab {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Car",
    categoryKeys: ["car"],
    subtypeKeys: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function aTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "transaction-1",
    investmentAccountId: "account-xtb",
    instrument: "VWCE.DE",
    currency: "EUR",
    side: "buy",
    amount: "150",
    quantity: "1.5",
    unitPrice: "100",
    executedAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

export function aValuation(overrides: Partial<NetWorthValuation> = {}): NetWorthValuation {
  return { id: "valuation-1", itemId: "item-1", value: "1000", valuedOn: "2026-09-19", ...overrides };
}

/** Defaults to one valuation that belongs to the item. */
export function aManualItem(overrides: Partial<NetWorthManualItemSource> = {}): NetWorthManualItemSource {
  const id = overrides.id ?? "item-1";
  return {
    id,
    name: "Current account",
    kind: "asset",
    category: "cash",
    currency: "EUR",
    purchaseAmount: null,
    archivedAt: null,
    valuations: [aValuation({ id: `${id}-valuation`, itemId: id })],
    ...overrides,
  };
}

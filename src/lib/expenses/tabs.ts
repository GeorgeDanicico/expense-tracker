import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { ExpenseTabFilters } from "@/lib/expenses/filters";
import type { Expense } from "@/lib/expenses/types";

export type ExpenseTab = {
  id: string;
  name: string;
  categoryKeys: ExpenseCategory[];
  subtypeKeys: ExpenseSubtype[];
  createdAt: string;
  updatedAt: string;
};

export type ExpenseTabInput = Pick<ExpenseTab, "name" | "categoryKeys" | "subtypeKeys">;

export type ExpenseTabLedgerData = {
  tab: ExpenseTab;
  filters: ExpenseTabFilters;
  expenses: Expense[];
  total: number;
  count: number;
  average: number;
};

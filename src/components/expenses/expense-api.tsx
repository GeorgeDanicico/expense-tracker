"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
import { EXPENSE_TABS_API_KEY, expenseApiUrl, expenseTabApiKey, type SavedTabResponse } from "@/lib/api/keys";
import type { ExpenseTab, ExpenseTabInput } from "@/lib/expenses/tabs";
import type { Expense } from "@/lib/expenses/types";
import type { ExpenseInput } from "@/lib/validation/expense";

type ExpenseResponse = { expense: Expense };

/**
 * Every expense and saved-tab write (audit D6). The app uses the REST API; `/dev/preview` swaps in an
 * in-memory one. `useExpenseWrites` calls these and keeps the cache in step.
 */
export type ExpenseApi = {
  /** Saves an expense already checked with `expenseSchema`, answering it as stored. Its date decides its month (D10). */
  create(input: ExpenseInput): Promise<Expense>;
  /** Writes the expense's fields, answering it as stored. */
  update(id: string, input: ExpenseInput): Promise<Expense>;
  remove(id: string): Promise<void>;
  /** Creates a tab, or changes the tab `id`. */
  saveTab(input: ExpenseTabInput, id?: string): Promise<ExpenseTab>;
  removeTab(id: string): Promise<void>;
};

export const restExpenseApi: ExpenseApi = {
  async create(input) {
    return (await apiRequest<ExpenseResponse>("/api/expenses", { method: "POST", body: JSON.stringify(input) })).expense;
  },
  async update(id, input) {
    // Cleared notes are a null in a patch.
    const body = { ...input, notes: input.notes || null };
    return (await apiRequest<ExpenseResponse>(expenseApiUrl(id), { method: "PATCH", body: JSON.stringify(body) })).expense;
  },
  async remove(id) {
    await apiRequest<{ success: true }>(expenseApiUrl(id), { method: "DELETE" });
  },
  async saveTab(input, id) {
    const url = id ? expenseTabApiKey(id) : EXPENSE_TABS_API_KEY;
    return (await apiRequest<SavedTabResponse>(url, { method: id ? "PATCH" : "POST", body: JSON.stringify(input) })).tab;
  },
  async removeTab(id) {
    await apiRequest<{ success: true }>(expenseTabApiKey(id), { method: "DELETE" });
  },
};

const ExpenseApiContext = createContext<ExpenseApi>(restExpenseApi);

export function ExpenseApiProvider({ api, children }: { api: ExpenseApi; children: ReactNode }) {
  return <ExpenseApiContext.Provider value={api}>{children}</ExpenseApiContext.Provider>;
}

export function useExpenseApi() {
  return useContext(ExpenseApiContext);
}

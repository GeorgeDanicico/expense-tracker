"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
import type { Expense } from "@/lib/expenses/types";
import type { ExpenseInput } from "@/lib/validation/expense";

/** The expense writes. The app uses the REST API; `/dev/preview` swaps in an in-memory one. */
export type ExpenseApi = {
  /** Saves an expense already checked with `expenseSchema`, answering it as stored. */
  create(input: ExpenseInput): Promise<Expense>;
};

export const restExpenseApi: ExpenseApi = {
  async create(input) {
    // The route still checks the date against a month, which the form no longer chooses: send the date's own.
    const body = { ...input, selectedMonth: input.expenseDate.slice(0, 7) };
    return (await apiRequest<{ expense: Expense }>("/api/expenses", { method: "POST", body: JSON.stringify(body) })).expense;
  },
};

const ExpenseApiContext = createContext<ExpenseApi>(restExpenseApi);

export function ExpenseApiProvider({ api, children }: { api: ExpenseApi; children: ReactNode }) {
  return <ExpenseApiContext.Provider value={api}>{children}</ExpenseApiContext.Provider>;
}

export function useExpenseApi() {
  return useContext(ExpenseApiContext);
}

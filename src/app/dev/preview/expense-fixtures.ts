import type { ExpenseApi } from "@/components/expenses/expense-api";
import { ApiError } from "@/lib/api/client";
import type { ClassifiedDescription } from "@/lib/expenses/repository";
import { suggestExpenses } from "@/lib/expenses/suggestions";

// The expense writes for `/dev/preview`: a save answers after a moment with the expense as stored,
// so the optimistic add, the save check and the toast can be seen; nothing is kept. Open a preview
// with `?failWrites=1` to have every save refused (and rolled back).

let counter = 0;

function failsWrites() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("failWrites");
}

export const previewExpenseApi: ExpenseApi = {
  async create(input) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (failsWrites()) throw new ApiError("Couldn't save. Try again.", 503);
    counter += 1;
    return { id: `preview-expense-${counter}`, ...input, notes: input.notes || null };
  },
};

/** The suggestions `GET /api/expenses/suggestions?q=` would answer for someone with these expenses (newest first). */
export function previewSuggestions(rows: readonly ClassifiedDescription[], query: string) {
  return suggestExpenses(rows, query);
}

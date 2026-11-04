import type { ExpenseApi } from "@/components/expenses/expense-api";
import { ApiError } from "@/lib/api/client";

// The expense writes for `/dev/preview`: each answers after a moment as the server would, so the
// optimistic add, edit and delete, the save check and the toasts can be seen; nothing is kept (a
// refetch brings the fixtures back). Open a preview with `?failWrites=1` to have every write refused
// (and rolled back).

let counter = 0;

function failsWrites() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("failWrites");
}

async function answer() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (failsWrites()) throw new ApiError("Couldn't save. Try again.", 503);
}

export const previewExpenseApi: ExpenseApi = {
  async create(input) {
    await answer();
    counter += 1;
    return { id: `preview-expense-${counter}`, ...input, notes: input.notes || null };
  },
  async update(id, input) {
    await answer();
    return { id, ...input, notes: input.notes || null };
  },
  async remove() {
    await answer();
  },
  async saveTab(input, id) {
    await answer();
    counter += 1;
    const now = new Date().toISOString();
    return { id: id ?? `preview-tab-${counter}`, ...input, createdAt: now, updatedAt: now };
  },
  async removeTab() {
    await answer();
  },
};

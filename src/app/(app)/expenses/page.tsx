import { loadExpensesFallback } from "@/lib/expenses/load-expenses-page";
import { ServerFallback } from "@/lib/api/server-fallback";

import { ExpensesClient } from "./expenses-client";

/**
 * Money → Expenses. A server component since PF7: it reads the month, the member and the tab from the
 * URL, starts their data here and the ledger streams in (`loadExpensesFallback`).
 */
export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  return (
    <ServerFallback fallback={await loadExpensesFallback(await searchParams)}>
      <ExpensesClient />
    </ServerFallback>
  );
}

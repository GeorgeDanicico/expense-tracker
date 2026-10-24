"use client";

import { Suspense } from "react";
import { SWRConfig, type Middleware } from "swr";

import DashboardPage from "@/app/(app)/dashboard/page";
import ExpensesPage from "@/app/(app)/expenses/page";
import InvestmentsPage from "@/app/(app)/investments/page";
import NetWorthPage from "@/app/(app)/net-worth/page";
import SettingsPage from "@/app/(app)/settings/page";
import TodosPage from "@/app/(app)/todos/page";
import { AppShell } from "@/components/layout/app-shell";
import { TodoApiProvider } from "@/components/todos/todo-api";

import { fixtureFor } from "../fixtures";
import { previewTodoApi } from "../todo-fixtures";
import type { PreviewScreen } from "./screens";

const SCREENS: Record<PreviewScreen, () => React.ReactNode> = {
  dashboard: DashboardPage,
  expenses: ExpensesPage,
  investments: InvestmentsPage,
  "net-worth": NetWorthPage,
  settings: SettingsPage,
  todos: TodosPreview,
};

/** The board with its writes kept in memory (see `todo-fixtures.ts`). */
function TodosPreview() {
  return (
    <TodoApiProvider api={previewTodoApi}>
      <TodosPage />
    </TodoApiProvider>
  );
}


/** Replaces every fetcher (including explicit ones) with the fixture resolver. */
const fixtures: Middleware = (useSWRNext) => (key, _fetcher, config) => {
  const fetcher = (resolved: string) => Promise.resolve(fixtureFor(resolved));
  return useSWRNext(key, fetcher as typeof _fetcher, config);
};

export function ScreenPreview({ screen }: { screen: PreviewScreen }) {
  const Screen = SCREENS[screen];
  return (
    <SWRConfig value={{ use: [fixtures], dedupingInterval: 60_000, revalidateOnFocus: false }}>
      <AppShell email="preview@example.com">
        <Suspense>
          <Screen />
        </Suspense>
      </AppShell>
    </SWRConfig>
  );
}

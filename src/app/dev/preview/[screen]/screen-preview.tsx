"use client";

import { Text } from "@chakra-ui/react";
import { Suspense } from "react";
import { SWRConfig, type Middleware } from "swr";

import CalendarPage from "@/app/(app)/calendar/page";
import DashboardPage from "@/app/(app)/dashboard/page";
import ExpensesPage from "@/app/(app)/expenses/page";
import ImportPage from "@/app/(app)/expenses/import/page";
import InvestmentsPage from "@/app/(app)/investments/page";
import NetWorthPage from "@/app/(app)/net-worth/page";
import RemindersPage from "@/app/(app)/reminders/page";
import AiFeaturesSettingsPage from "@/app/(app)/settings/ai/page";
import SettingsLayout from "@/app/(app)/settings/layout";
import NotificationsSettingsPage from "@/app/(app)/settings/notifications/page";
import SettingsPage from "@/app/(app)/settings/page";
import TodosPage from "@/app/(app)/todos/page";
import { ImportApiProvider } from "@/components/expenses/import/import-api";
import { CalendarApiProvider } from "@/components/family-calendar/calendar-api";
import { AppShell } from "@/components/layout/app-shell";
import { ReminderApiProvider } from "@/components/reminders/reminder-api";
import { TodoApiProvider } from "@/components/todos/todo-api";

import { previewCalendarApi } from "../calendar-fixtures";
import { fixtureFor } from "../fixtures";
import { previewImportApi, previewSampleStatement } from "../import-fixtures";
import { previewReminderApi } from "../reminder-fixtures";
import { previewTodoApi } from "../todo-fixtures";
import type { PreviewScreen } from "./screens";

const SCREENS: Record<PreviewScreen, () => React.ReactNode> = {
  dashboard: DashboardPage,
  expenses: ExpensesPage,
  investments: InvestmentsPage,
  "net-worth": NetWorthPage,
  settings: SettingsPage,
  todos: TodosPreview,
  reminders: RemindersPreview,
  calendar: CalendarPreview,
  notifications: NotificationsPreview,
  "ai-settings": AiSettingsPreview,
  import: ImportPreview,
};

/**
 * The import page with its drafts and expenses kept in memory (see `import-fixtures.ts`). The
 * sample statement is a download, so a file can be chosen on the upload step as on a real device.
 */
function ImportPreview() {
  const sample = `data:text/csv;charset=utf-8,${encodeURIComponent(previewSampleStatement())}`;
  return (
    <ImportApiProvider api={previewImportApi}>
      <Text textStyle="caption" mb="3">
        Preview: nothing is saved. <a href={sample} download="sample-statement.csv" data-testid="sample-statement">Download a sample statement</a> to upload.
      </Text>
      <ImportPage />
    </ImportApiProvider>
  );
}

/** Settings → Notifications with its tabs. Its writes reach the real API (and fail when signed out). */
function NotificationsPreview() {
  return (
    <SettingsLayout>
      <NotificationsSettingsPage />
    </SettingsLayout>
  );
}

/** Settings → AI features with its tabs. `?ai=on` and `?ai=kid` preview the other states (see `fixtures.ts`). */
function AiSettingsPreview() {
  return (
    <SettingsLayout>
      <AiFeaturesSettingsPage />
    </SettingsLayout>
  );
}

/** The board with its writes kept in memory (see `todo-fixtures.ts`). */
function TodosPreview() {
  return (
    <TodoApiProvider api={previewTodoApi}>
      <TodosPage />
    </TodoApiProvider>
  );
}

/** The calendar with its events and writes kept in memory (see `calendar-fixtures.ts`). */
function CalendarPreview() {
  return (
    <CalendarApiProvider api={previewCalendarApi}>
      <CalendarPage />
    </CalendarApiProvider>
  );
}

/** The reminders with their writes kept in memory (see `reminder-fixtures.ts`). */
function RemindersPreview() {
  return (
    <ReminderApiProvider api={previewReminderApi}>
      <RemindersPage />
    </ReminderApiProvider>
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

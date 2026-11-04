"use client";

import { Text } from "@chakra-ui/react";
import { Suspense } from "react";
import { SWRConfig, type Middleware } from "swr";

import CalendarPage from "@/app/(app)/calendar/page";
import DashboardPage from "@/app/(app)/dashboard/page";
import InsightsPage from "@/app/(app)/insights/page";
import ExpensesPage from "@/app/(app)/expenses/page";
import ImportPage from "@/app/(app)/expenses/import/page";
import InvestmentsPage from "@/app/(app)/investments/page";
import MorePage from "@/app/(app)/more/page";
import NetWorthPage from "@/app/(app)/net-worth/page";
import RemindersPage from "@/app/(app)/reminders/page";
import FamilySettingsPage from "@/app/(app)/settings/family/page";
import ManageFamilyPage from "@/app/(app)/settings/family/manage/page";
import MyPermissionsPage from "@/app/(app)/settings/permissions/page";
import AiFeaturesSettingsPage from "@/app/(app)/settings/ai/page";
import SettingsLayout from "@/app/(app)/settings/layout";
import NotificationsSettingsPage from "@/app/(app)/settings/notifications/page";
import SettingsPage from "@/app/(app)/settings/page";
import TodosPage from "@/app/(app)/todos/page";
import ChangePasswordPage from "@/app/change-password/page";
import { ExpenseApiProvider } from "@/components/expenses/expense-api";
import { FamilyApiProvider } from "@/components/family/family-api";
import { ImportApiProvider } from "@/components/expenses/import/import-api";
import { CalendarApiProvider } from "@/components/family-calendar/calendar-api";
import { InvestmentApiProvider } from "@/components/investments/investment-api";
import { AppShell } from "@/components/layout/app-shell";
import { AppPathProvider } from "@/components/layout/use-app-pathname";
import { NetWorthApiProvider } from "@/components/net-worth/net-worth-api";
import type { QuickAddOptions } from "@/components/quick-add/quick-add-provider";
import { ReminderApiProvider } from "@/components/reminders/reminder-api";
import { TodoApiProvider } from "@/components/todos/todo-api";

import { previewCalendarApi } from "../calendar-fixtures";
import { previewFamilyApi } from "../family-fixtures";
import { previewExpenseApi } from "../expense-fixtures";
import { fixtureFor } from "../fixtures";
import { previewInvestmentApi, previewNetWorthApi } from "../money-fixtures";
import { PREVIEW_READ_STATEMENT_FILE, previewImportApi, previewSampleStatement } from "../import-fixtures";
import { previewReminderApi } from "../reminder-fixtures";
import { previewTodoApi } from "../todo-fixtures";
import type { PreviewScreen } from "./screens";

const SCREENS: Record<PreviewScreen, () => React.ReactNode> = {
  dashboard: DashboardPage,
  insights: InsightsPage,
  more: MorePage,
  expenses: ExpensesPage,
  investments: InvestmentsPage,
  "net-worth": NetWorthPage,
  settings: SettingsPreview,
  todos: TodosPage,
  reminders: RemindersPage,
  calendar: CalendarPage,
  notifications: NotificationsPreview,
  "ai-settings": AiSettingsPreview,
  family: FamilyPreview,
  "manage-family": ManageFamilyPreview,
  permissions: PermissionsPreview,
  import: ImportPreview,
  "change-password": ChangePasswordPage,
};

/** The app page each screen stands for, so the navigation highlights it though the URL is `/dev/preview/…`. */
const APP_PATH: Record<PreviewScreen, string> = {
  dashboard: "/dashboard",
  insights: "/insights",
  more: "/more",
  expenses: "/expenses",
  investments: "/investments",
  "net-worth": "/net-worth",
  settings: "/settings",
  todos: "/todos",
  reminders: "/reminders",
  calendar: "/calendar",
  notifications: "/settings/notifications",
  "ai-settings": "/settings/ai",
  family: "/settings/family",
  "manage-family": "/settings/family/manage",
  permissions: "/settings/permissions",
  import: "/expenses/import",
  "change-password": "/change-password",
};

/** Screens that are a page of their own, outside the app shell. */
const WITHOUT_SHELL: ReadonlySet<PreviewScreen> = new Set(["change-password"]);

/**
 * The import page with its drafts and expenses kept in memory (see `import-fixtures.ts`). The
 * sample statement is a download, so a file can be chosen on the upload step as on a real device.
 */
function ImportPreview() {
  const sample = `data:text/csv;charset=utf-8,${encodeURIComponent(previewSampleStatement())}`;
  return (
    <ImportApiProvider api={previewImportApi}>
      <Text textStyle="caption" mb="3">
        Preview: nothing is saved. <a href={sample} download="sample-statement.csv" data-testid="sample-statement">Download a sample statement</a> to upload,
        or <a href={sample} download={PREVIEW_READ_STATEMENT_FILE} data-testid="sample-read-statement">a statement the AI read</a> (its category sources and warnings).
        {" "}<code>?ai=on</code> turns the AI switch on.
      </Text>
      <ImportPage />
    </ImportApiProvider>
  );
}

/** Settings → Account with the list beside it. */
function SettingsPreview() {
  return (
    <SettingsLayout>
      <SettingsPage />
    </SettingsLayout>
  );
}

/** Settings → Notifications with the list beside it. Its writes reach the real API (and fail when signed out). */
function NotificationsPreview() {
  return (
    <SettingsLayout>
      <NotificationsSettingsPage />
    </SettingsLayout>
  );
}

/** Settings → AI features with the list beside it. `?ai=on` and `?ai=kid` preview the other states (see `fixtures.ts`). */
function AiSettingsPreview() {
  return (
    <SettingsLayout>
      <AiFeaturesSettingsPage />
    </SettingsLayout>
  );
}

/** Settings → Family, Manage family and My permissions with the list beside them (`?kid=1` previews a kid; `?noFamily=1` no family). */
function FamilyPreview() {
  return (
    <SettingsLayout>
      <FamilySettingsPage />
    </SettingsLayout>
  );
}

function ManageFamilyPreview() {
  return (
    <SettingsLayout>
      <ManageFamilyPage />
    </SettingsLayout>
  );
}

function PermissionsPreview() {
  return (
    <SettingsLayout>
      <MyPermissionsPage />
    </SettingsLayout>
  );
}

/**
 * Every screen's writes, and the quick-add sheet's, kept in memory: expenses (`expense-fixtures.ts`),
 * investments and net worth (`money-fixtures.ts`), the board (`todo-fixtures.ts`), reminders (`reminder-fixtures.ts`) and the calendar
 * (`calendar-fixtures.ts`) and the family's (`family-fixtures.ts`).
 */
function PreviewApis({ children }: { children: React.ReactNode }) {
  return (
    <ExpenseApiProvider api={previewExpenseApi}>
      <InvestmentApiProvider api={previewInvestmentApi}>
        <NetWorthApiProvider api={previewNetWorthApi}>
          <TodoApiProvider api={previewTodoApi}>
            <ReminderApiProvider api={previewReminderApi}>
              <CalendarApiProvider api={previewCalendarApi}>
                <FamilyApiProvider api={previewFamilyApi}>{children}</FamilyApiProvider>
              </CalendarApiProvider>
            </ReminderApiProvider>
          </TodoApiProvider>
        </NetWorthApiProvider>
      </InvestmentApiProvider>
    </ExpenseApiProvider>
  );
}

/** Replaces every fetcher (including explicit ones) with the fixture resolver. */
const fixtures: Middleware = (useSWRNext) => (key, _fetcher, config) => {
  const fetcher = (resolved: string) => Promise.resolve(fixtureFor(resolved));
  return useSWRNext(key, fetcher as typeof _fetcher, config);
};

export function ScreenPreview({ screen, quickAdd = null }: { screen: PreviewScreen; quickAdd?: QuickAddOptions | null }) {
  const Screen = SCREENS[screen];
  const content = (
    <Suspense>
      <Screen />
    </Suspense>
  );
  return (
    <SWRConfig value={{ use: [fixtures], dedupingInterval: 60_000, revalidateOnFocus: false }}>
      <PreviewApis>
        {WITHOUT_SHELL.has(screen) ? content : (
          <AppPathProvider value={APP_PATH[screen]}>
            <AppShell signInName="preview@example.com" quickAdd={quickAdd}>{content}</AppShell>
          </AppPathProvider>
        )}
      </PreviewApis>
    </SWRConfig>
  );
}

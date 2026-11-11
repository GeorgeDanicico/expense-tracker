"use client";

import { Box, Stack, Text } from "@chakra-ui/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import type { ExpenseRowActions } from "@/components/expenses/expense-rows";
import { ExpenseTabChips } from "@/components/expenses/expense-tabs";
import { ExpensesMenu, expensesMenuItems } from "@/components/expenses/expenses-menu";
import { LedgerPanel } from "@/components/expenses/ledger-panel";
import { MonthToolbar } from "@/components/expenses/month-toolbar";
import { useExpenseDelete, useExpenseWrites } from "@/components/expenses/use-expense-writes";
import { ViewingBar, ViewingMenu } from "@/components/family/viewing-picker";
import { PermissionGate } from "@/components/layout/permission-gate";
import { StreamedSection } from "@/components/ui/streamed-section";
import { DataError, DataRefresh } from "@/components/ui/data-state";
import { lazySheet, useOpenedOnce } from "@/components/ui/lazy-sheet";
import { PageHeader } from "@/components/ui/page-header";
import { ExpensesSkeleton, LedgerSkeleton, RowsCardSkeleton } from "@/components/ui/skeletons";
import { UndoToast } from "@/components/ui/undo-toast";
import { useApiForm } from "@/hooks/use-api-form";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useExpenseTabRouting } from "@/hooks/use-expense-tab-routing";
import { useViewing } from "@/hooks/use-viewing";
import { expenseTabsApiKey, FAMILY_API_KEY, mainExpensesExportUrl, type TabsResponse } from "@/lib/api/keys";
import { useServerFirstSWR } from "@/lib/api/server-fallback";
import { getBucharestMonth, resolveMainExpenseMonth } from "@/lib/calendar";
import { preloadOnIntent } from "@/lib/client/preload";
import type { Expense } from "@/lib/expenses/types";
import type { ExpenseTab } from "@/lib/expenses/tabs";

// What opens on a tap, or only on a saved tab, is loaded when it is first wanted (PF9): the expense form (and the
// validation library it brings), the tab dialog, the delete confirmation and the saved tab's own screen.
const editSheet = lazySheet(() => import("@/components/expenses/edit-expense-sheet").then((module) => module.EditExpenseSheet));
const tabDialogSheet = lazySheet(() => import("@/components/expenses/expense-tab-dialog").then((module) => module.ExpenseTabDialog));
const confirmSheet = lazySheet(() => import("@/components/ui/confirm-dialog").then((module) => module.ConfirmDialog));
const customTab = lazySheet(() => import("@/components/expenses/custom-expense-tab").then((module) => module.CustomExpenseTab));
const EditExpenseSheet = editSheet.Sheet;
const ExpenseTabDialog = tabDialogSheet.Sheet;
const ConfirmDialog = confirmSheet.Sheet;
const CustomExpenseTab = customTab.Sheet;

/** Starts loading what a tap on this page can open, once the pointer, focus or a finger is on the page. */
function preloadSheets() {
  editSheet.preload();
  tabDialogSheet.preload();
  confirmSheet.preload();
  customTab.preload();
}

type TabDialog = { mode: "create" } | { mode: "edit"; tab: ExpenseTab };

/**
 * Money → Expenses, to the signed-off mockup (U8): the month and the member as compact controls, the
 * saved tabs as a row of chips, import and export behind `⋯`, and the month's rows grouped by day with
 * Edit and Delete (with Undo) on each. Adding is the bottom bar's + (one primary action per screen).
 */
function ExpensesContent() {
  useDocumentTitle("Expenses");
  const searchParams = useSearchParams();
  const month = resolveMainExpenseMonth(searchParams.get("month"));
  const viewing = useViewing();
  const writes = useExpenseWrites();
  const deletes = useExpenseDelete();
  const {
    data: tabsResult,
    error: tabsError,
    isValidating: tabsUpdating,
    mutate: mutateTabs,
  } = useServerFirstSWR<TabsResponse>(
    // Saved tabs belong to one person, so the family view has none.
    viewing.family ? null : expenseTabsApiKey(viewing.member),
  );
  const tabs = tabsResult?.tabs ?? [];
  const [tabDialog, setTabDialog] = useState<TabDialog | null>(null);
  const [deletingTab, setDeletingTab] = useState<ExpenseTab | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const editOpened = useOpenedOnce(editing !== null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const tabDelete = useApiForm();
  const deleteOpened = useOpenedOnce(deletingTab !== null);
  const { activeTabId, activeTab, changeTab, saveTab, returnToMain } = useExpenseTabRouting(tabsResult);
  const openTab = activeTabId ? (tabs.find((tab) => tab.id === activeTabId) ?? null) : null;

  const actions: ExpenseRowActions | undefined = viewing.readOnly
    ? undefined
    : { edit: setEditing, remove: deletes.remove, hidden: deletes.hidden };
  const menuItems = expensesMenuItems({
    readOnly: viewing.readOnly,
    family: viewing.family,
    tab: openTab,
    exportHref: mainExpensesExportUrl(month, viewing.member),
  });

  // The month with the member (on a saved tab, which spans every month, the member moves up beside
  // ⋯), then the tab chips: the list's own controls.
  const controls = (
    <>
      {activeTabId ? null : (
        <MonthToolbar month={month} maxMonth={getBucharestMonth()} href={(value) => viewing.hrefFor(`/expenses?month=${value}`)}>
          <ViewingMenu allowFamily />
        </MonthToolbar>
      )}
      <ExpenseTabChips
        tabs={tabs}
        value={activeTab}
        onValueChange={changeTab}
        onCreate={viewing.readOnly ? undefined : () => setTabDialog({ mode: "create" })}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
      />
    </>
  );

  function deleteTab(tab: ExpenseTab) {
    void tabDelete.submit(async () => {
      await writes.removeTab(tab.id);
      setDeletingTab(null);
      returnToMain();
    }, { fallback: "Unable to delete this tab." });
  }

  return (
    <Stack gap="3" {...preloadOnIntent(preloadSheets)}>
      <PageHeader
        title="Expenses"
        inline
        actions={
          <>
            {activeTabId ? <ViewingMenu allowFamily /> : null}
            <ExpensesMenu
              items={menuItems}
              onSelect={(value) => {
                if (!openTab) return;
                if (value === "edit-tab") setTabDialog({ mode: "edit", tab: openTab });
                else setDeletingTab(openTab);
              }}
            />
          </>
        }
      />

      <ViewingBar noun="expenses" />

      {tabsError ? (
        <DataRefresh error={tabsError} updating={tabsUpdating} retry={() => void mutateTabs()} />
      ) : null}

      {activeTabId ? controls : null}
      {!viewing.ready ? (
        activeTabId
          ? <RowsCardSkeleton label="Loading expenses…" slowKey={FAMILY_API_KEY} />
          : <LedgerSkeleton controls={controls} slowKey={FAMILY_API_KEY} />
      ) : !activeTabId ? (
        <LedgerPanel month={month} currency={viewing.currency} filtersOpen={filtersOpen} actions={actions} controls={controls} />
      ) : openTab ? (
        <CustomExpenseTab key={openTab.id} tab={openTab} currency={viewing.currency} filtersOpen={filtersOpen} actions={actions} />
      ) : !tabsResult ? (
        tabsError ? (
          <DataError message="Saved expense tabs could not be loaded." retry={() => void mutateTabs()} />
        ) : <RowsCardSkeleton label="Loading saved tabs…" slowKey={expenseTabsApiKey(viewing.member)} />
      ) : (
        <Box py="8" role="status">
          <Text textStyle="bodySm" color="fg.muted">This tab is no longer available. Returning to Expenses…</Text>
        </Box>
      )}

      {editOpened ? <EditExpenseSheet expense={editing} currency={viewing.currency} onClose={() => setEditing(null)} /> : null}
      <UndoToast {...deletes.toast} />

      {tabDialog ? (
        <ExpenseTabDialog
          key={tabDialog.mode === "edit" ? tabDialog.tab.id : "new"}
          open
          onOpenChange={(open) => { if (!open) setTabDialog(null); }}
          tab={tabDialog.mode === "edit" ? tabDialog.tab : undefined}
          onSaved={(tab) => {
            const keepFilters = tabDialog.mode === "edit";
            setTabDialog(null);
            saveTab(tab, { keepFilters });
          }}
        />
      ) : null}

      {deleteOpened ? <ConfirmDialog
        open={deletingTab !== null}
        onOpenChange={(open) => { if (!open) setDeletingTab(null); }}
        title="Delete this tab?"
        description={deletingTab ? `“${deletingTab.name}” will be removed from your saved tabs. Your expenses stay in the main ledger.` : undefined}
        cancelLabel="Keep tab"
        confirmLabel="Delete tab"
        pending={tabDelete.pending}
        error={tabDelete.error}
        onConfirm={() => { if (deletingTab) deleteTab(deletingTab); }}
      /> : null}
    </Stack>
  );
}

/** The Expenses page's body. The page streams in as the server's data arrives (`useSearchParams` needs a boundary too). */
export function ExpensesClient() {
  return (
    <PermissionGate module="expenses">
      <StreamedSection fallback={<ExpensesSkeleton />}>
        <ExpensesContent />
      </StreamedSection>
    </PermissionGate>
  );
}

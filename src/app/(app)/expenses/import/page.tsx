"use client";

import { Stack } from "@chakra-ui/react";
import { Suspense } from "react";

import { ImportScreen } from "@/components/expenses/import/import-screen";
import { PermissionGate } from "@/components/layout/permission-gate";
import { DataLoading } from "@/components/ui/data-state";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * Statement import (docs/statement-import-plan.md): upload a CSV (or resume a recent draft), review
 * the draft rows, confirm, and undo an import from the list of recent ones.
 * Part of Expenses, so it follows that page's permission; the Import statement button in the Expenses
 * header links here. It never reads `?member=`: an import only ever creates the caller's own expenses.
 */
export default function ImportPage() {
  useDocumentTitle("Import a statement");
  return (
    <PermissionGate module="expenses">
      <Stack gap={{ base: "4", md: "5" }}>
        {/* The screen reads `?draft=`, which needs a Suspense boundary above it. */}
        <Suspense fallback={<DataLoading label="Loading the import page…" layout="section" />}>
          <ImportScreen />
        </Suspense>
      </Stack>
    </PermissionGate>
  );
}

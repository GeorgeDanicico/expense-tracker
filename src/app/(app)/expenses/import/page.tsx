"use client";

import { Stack } from "@chakra-ui/react";

import { ImportScreen } from "@/components/expenses/import/import-screen";
import { PermissionGate } from "@/components/layout/permission-gate";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * Statement import (docs/statement-import-plan.md): upload a CSV, review the draft rows, confirm.
 * Part of Expenses, so it follows that page's permission; nothing links here yet (task I11 adds the
 * Import button). It never reads `?member=`: an import only ever creates the caller's own expenses.
 */
export default function ImportPage() {
  useDocumentTitle("Import a statement");
  return (
    <PermissionGate module="expenses">
      <Stack gap={{ base: "4", md: "5" }}>
        <ImportScreen />
      </Stack>
    </PermissionGate>
  );
}

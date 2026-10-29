"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RecentImport } from "@/lib/imports/repository";
import { undoAdvice, undoSummary, UNDO_TITLE } from "@/lib/imports/recent";

export const UNDO_CONFIRM_LABEL = "Undo import";

/** What the undo dialog says, as one string: the counts, then what stays. */
export function undoDescription(counts: Pick<RecentImport, "expenseCount" | "changedCount">, importedOn: string): string {
  return `${undoSummary(counts, importedOn)} ${undoAdvice(counts)}`;
}

/**
 * The confirmation before an import is undone, from the repository's counts: how many expenses go
 * and how many of them were edited since. Used by the list of recent imports and the result view.
 */
export function UndoImportDialog({
  open,
  onOpenChange,
  counts,
  importedOn,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: Pick<RecentImport, "expenseCount" | "changedCount">;
  /** The day the import was confirmed, as it is written in the sentence ("3 October"). */
  importedOn: string;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={UNDO_TITLE}
      description={undoDescription(counts, importedOn)}
      confirmLabel={UNDO_CONFIRM_LABEL}
      onConfirm={onConfirm}
      pending={pending}
      error={error}
    />
  );
}

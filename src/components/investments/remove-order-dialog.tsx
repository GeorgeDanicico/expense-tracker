"use client";

import { Stack, Text } from "@chakra-ui/react";

import { useInvestmentWrites } from "@/components/investments/use-investment-writes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApiForm } from "@/hooks/use-api-form";
import { formatDateTime } from "@/lib/calendar";
import type { InvestmentTransactionDto } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

/**
 * Confirms removing one order, opened from the row's actions. Removing can change the position the
 * later orders are checked against, so it waits for the server (no Undo, no optimism).
 */
export function RemoveOrderDialog({
  instrument,
  currency,
  transaction,
  onClose,
  onDeleted,
}: {
  instrument: string;
  currency: string;
  /** The order to remove; the dialog is closed when null. */
  transaction: InvestmentTransactionDto | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const writes = useInvestmentWrites();
  const form = useApiForm();

  function remove() {
    if (!transaction) return;
    void form.submit(async () => {
      await writes.removeOrder(transaction.id);
      onClose();
      onDeleted();
    }, { fallback: "Unable to remove this order." });
  }

  const side = transaction?.side === "sell" ? "Sell" : "Buy";

  return (
    <ConfirmDialog
      open={transaction !== null}
      onOpenChange={(open) => {
        if (open) return;
        form.reset();
        onClose();
      }}
      title="Remove this order?"
      description="This permanently removes the recorded order. Totals and cost basis will be recalculated from the remaining history."
      cancelLabel="Keep order"
      confirmLabel="Remove order"
      pending={form.pending}
      error={form.error}
      onConfirm={remove}
    >
      {transaction ? (
        <Stack gap="0.5" px="3" py="2.5" borderRadius="control" bg="bg.subtle">
          <Text textStyle="bodySm" fontWeight="medium">{side} · {instrument}</Text>
          <Text textStyle="caption">{transaction.quantity} units · {formatInvestmentAmount(transaction.amount, currency)}</Text>
          <Text textStyle="caption">Executed {formatDateTime(transaction.executedAt)}</Text>
        </Stack>
      ) : null}
      <Text className="sr-only" role="status" aria-live="polite">
        {form.pending ? "Removing order…" : ""}
      </Text>
    </ConfirmDialog>
  );
}

"use client";

import { Button, Stack, Text } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { ApiError, apiRequest } from "@/lib/api/client";
import { afterInvestmentChange } from "@/lib/api/invalidate";
import { investmentTransactionsApiKey } from "@/lib/api/keys";
import type { InvestmentTransactionDto } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/calendar";

export function RemoveOrderDialog({
  accountId,
  instrument,
  currency,
  transaction,
  onDeleted,
}: {
  accountId: string;
  instrument: string;
  currency: string;
  transaction: InvestmentTransactionDto;
  onDeleted: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (pending) return;
    setPending(true);
    setError("");

    try {
      await apiRequest<Record<string, never>>(`/api/investment-transactions/${encodeURIComponent(transaction.id)}`, {
        method: "DELETE",
      });

      const detailKey = investmentTransactionsApiKey({ accountId, instrument, currency });
      await afterInvestmentChange(mutate, detailKey);
      setOpen(false);
      onDeleted();
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "Unable to remove this order.");
    } finally {
      setPending(false);
    }
  }

  const side = transaction.side === "buy" ? "Buy" : "Sell";

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          type="button"
          size="xs"
          variant="ghost"
          colorPalette="danger"
          aria-label={`Remove ${side.toLowerCase()} order for ${instrument}`}
        >
          <Trash2 size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Remove
        </Button>
      }
      title="Remove this order?"
      description="This permanently removes the recorded order. Totals and cost basis will be recalculated from the remaining history."
      cancelLabel="Keep order"
      confirmLabel="Remove order"
      pending={pending}
      error={error}
      onConfirm={() => void remove()}
    >
      <Stack gap="0.5" px="3" py="2.5" borderRadius="control" bg="bg.subtle">
        <Text textStyle="bodySm" fontWeight="medium">{side} · {instrument}</Text>
        <Text textStyle="caption">{transaction.quantity} units · {formatInvestmentAmount(transaction.amount, currency)}</Text>
        <Text textStyle="caption">Executed {formatDateTime(transaction.executedAt)}</Text>
      </Stack>
      <Text className="sr-only" role="status" aria-live="polite">
        {pending ? "Removing order…" : ""}
      </Text>
    </ConfirmDialog>
  );
}

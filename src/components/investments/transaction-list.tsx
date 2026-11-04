"use client";

import { Stack } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { RemoveOrderDialog } from "@/components/investments/remove-order-dialog";
import { Amount } from "@/components/ui/amount";
import { ListRow } from "@/components/ui/list-row";
import { RowActions, useRowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { useViewing } from "@/hooks/use-viewing";
import { formatDateTime } from "@/lib/calendar";
import type { InvestmentTransactionDto } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

function SideBadge({ side }: { side: InvestmentTransactionDto["side"] }) {
  return <StatusBadge tone={side === "buy" ? "info" : "warning"}>{side === "buy" ? "Buy" : "Sell"}</StatusBadge>;
}

function OrderRow({
  transaction,
  currency,
  onRemove,
}: {
  transaction: InvestmentTransactionDto;
  currency: string;
  /** Absent while read-only. */
  onRemove?: (transaction: InvestmentTransactionDto) => void;
}) {
  const { rowProps, menu } = useRowActions();
  const actions = onRemove ? [{ label: "Remove", icon: Trash2, tone: "danger" as const, onSelect: () => onRemove(transaction) }] : null;
  const side = transaction.side === "buy" ? "Buy" : "Sell";
  return (
    <ListRow
      {...(actions ? rowProps : {})}
      leading={<SideBadge side={transaction.side} />}
      title={`${transaction.quantity} units at ${formatInvestmentAmount(transaction.unitPrice, currency)}`}
      meta={formatDateTime(transaction.executedAt)}
      trailing={
        <>
          {actions ? <RowActions label={`${side} order of ${formatDateTime(transaction.executedAt)}`} actions={actions} {...menu} /> : null}
          <Amount value={transaction.amount} currency={currency} size="sm" />
        </>
      }
    />
  );
}

/** An asset's orders, newest first: one list at every width, Remove in each row's `⋯` (hover icon on desktop). */
export function TransactionList({
  instrument,
  transactions,
  currency,
  onDeleted,
}: {
  instrument: string;
  transactions: InvestmentTransactionDto[];
  currency: string;
  onDeleted: () => void;
}) {
  const { readOnly } = useViewing();
  const [removing, setRemoving] = useState<InvestmentTransactionDto | null>(null);

  return (
    <>
      <Stack as="ul" gap="0.5" m="0" px="2" py="1" aria-label="Investment transaction history">
        {transactions.map((transaction) => (
          <OrderRow key={transaction.id} transaction={transaction} currency={currency} onRemove={readOnly ? undefined : setRemoving} />
        ))}
      </Stack>
      <RemoveOrderDialog
        instrument={instrument}
        currency={currency}
        transaction={removing}
        onClose={() => setRemoving(null)}
        onDeleted={onDeleted}
      />
    </>
  );
}

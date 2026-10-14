import { Box, Flex, Stack, Table, Text } from "@chakra-ui/react";

import { RemoveOrderDialog } from "@/components/investments/remove-order-dialog";
import { Amount } from "@/components/ui/amount";
import { StatusBadge } from "@/components/ui/status-badge";
import type { InvestmentTransactionDto } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/calendar";

function SideBadge({ side }: { side: InvestmentTransactionDto["side"] }) {
  return <StatusBadge tone={side === "buy" ? "info" : "warning"}>{side === "buy" ? "Buy" : "Sell"}</StatusBadge>;
}

export function TransactionList({
  accountId,
  instrument,
  transactions,
  currency,
  onDeleted,
}: {
  accountId: string;
  instrument: string;
  transactions: InvestmentTransactionDto[];
  currency: string;
  onDeleted: () => void;
}) {
  const remove = (transaction: InvestmentTransactionDto) => (
    <RemoveOrderDialog
      accountId={accountId}
      instrument={instrument}
      currency={currency}
      transaction={transaction}
      onDeleted={onDeleted}
    />
  );

  return (
    <>
      <Box display={{ base: "none", lg: "block" }} overflowX="auto">
        <Table.Root interactive>
          <Table.Caption className="sr-only">Investment transaction history</Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader ps="4">Side</Table.ColumnHeader>
              <Table.ColumnHeader>Executed</Table.ColumnHeader>
              <Table.ColumnHeader data-numeric>Quantity</Table.ColumnHeader>
              <Table.ColumnHeader data-numeric>Unit price</Table.ColumnHeader>
              <Table.ColumnHeader data-numeric>Order value</Table.ColumnHeader>
              <Table.ColumnHeader width="6rem" pe="3"><span className="sr-only">Actions</span></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {transactions.map((transaction) => (
              <Table.Row key={transaction.id}>
                <Table.Cell ps="4"><SideBadge side={transaction.side} /></Table.Cell>
                <Table.Cell color="fg.muted" whiteSpace="nowrap">{formatDateTime(transaction.executedAt)}</Table.Cell>
                <Table.Cell data-numeric fontWeight="medium">{transaction.quantity} units</Table.Cell>
                <Table.Cell data-numeric color="fg.muted">{formatInvestmentAmount(transaction.unitPrice, currency)}</Table.Cell>
                <Table.Cell data-numeric><Amount value={transaction.amount} currency={currency} size="sm" /></Table.Cell>
                <Table.Cell pe="3" textAlign="end">
                  <Box data-row-action display="inline-flex">{remove(transaction)}</Box>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>

      <Box as="ul" display={{ base: "block", lg: "none" }} px="4" m="0" listStyleType="none" divideY="1px" divideColor="border">
        {transactions.map((transaction) => (
          <Flex as="li" key={transaction.id} align="center" justify="space-between" gap="3" py="2.5">
            <Stack minW="0" gap="0.5">
              <Flex align="center" gap="2">
                <SideBadge side={transaction.side} />
                <Text textStyle="caption" truncate>{formatDateTime(transaction.executedAt)}</Text>
              </Flex>
              <Text textStyle="caption">{transaction.quantity} units at {formatInvestmentAmount(transaction.unitPrice, currency)}</Text>
            </Stack>
            <Flex flexShrink="0" align="center" gap="1">
              <Amount value={transaction.amount} currency={currency} size="sm" />
              {remove(transaction)}
            </Flex>
          </Flex>
        ))}
      </Box>
    </>
  );
}

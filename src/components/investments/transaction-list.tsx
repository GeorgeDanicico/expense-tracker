import { Badge, Box, Flex, Stack, Table, Text } from "@chakra-ui/react";

import { RemoveOrderDialog } from "@/components/investments/remove-order-dialog";
import type { InvestmentTransactionDto } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/utils/dates";

function sideColor(side: InvestmentTransactionDto["side"]) {
  return side === "buy" ? "blue" : "orange";
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
  return (
    <>
      <Box display={{ base: "none", md: "block" }} overflowX="auto">
        <Table.Root size="sm" variant="line">
          <Table.Caption className="sr-only">Investment transaction history</Table.Caption>
          <Table.Header>
            <Table.Row bg="gray.50">
              <Table.ColumnHeader pl="5" py="3.5" color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.06em">SIDE</Table.ColumnHeader>
              <Table.ColumnHeader py="3.5" color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.06em">EXECUTED</Table.ColumnHeader>
              <Table.ColumnHeader py="3.5" color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.06em" textAlign="end">QUANTITY</Table.ColumnHeader>
              <Table.ColumnHeader py="3.5" color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.06em" textAlign="end">UNIT PRICE</Table.ColumnHeader>
              <Table.ColumnHeader pr="5" py="3.5" color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.06em" textAlign="end">ORDER VALUE</Table.ColumnHeader>
              <Table.ColumnHeader width="7rem" pr="5"><span className="sr-only">Actions</span></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {transactions.map((transaction) => (
              <Table.Row key={transaction.id} _hover={{ bg: "purple.50/40" }}>
                <Table.Cell pl="5" py="3.5">
                  <Badge colorPalette={sideColor(transaction.side)} variant="subtle" borderRadius="full" px="2.5" py="1">
                    {transaction.side === "buy" ? "Buy" : "Sell"}
                  </Badge>
                </Table.Cell>
                <Table.Cell color="gray.600" whiteSpace="nowrap">{formatDateTime(transaction.executedAt)}</Table.Cell>
                <Table.Cell textAlign="end" color="gray.900" fontWeight="700" whiteSpace="nowrap">
                  {transaction.quantity} units
                </Table.Cell>
                <Table.Cell textAlign="end" color="gray.600" whiteSpace="nowrap">
                  {formatInvestmentAmount(transaction.unitPrice, currency)}
                </Table.Cell>
                <Table.Cell pr="5" textAlign="end" color="gray.900" fontWeight="800" whiteSpace="nowrap">
                  {formatInvestmentAmount(transaction.amount, currency)}
                </Table.Cell>
                <Table.Cell pr="5" textAlign="end">
                  <RemoveOrderDialog
                    accountId={accountId}
                    instrument={instrument}
                    currency={currency}
                    transaction={transaction}
                    onDeleted={onDeleted}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>

      <Stack display={{ base: "flex", md: "none" }} gap="0" px="3" pb="2">
        {transactions.map((transaction) => (
          <Flex key={transaction.id} align="flex-start" justify="space-between" gap="4" px="2" py="3.5" borderBottomWidth="1px" borderColor="gray.100" _last={{ borderBottomWidth: "0" }}>
            <Stack minW="0" gap="1.5">
              <Flex align="center" gap="2">
                <Badge colorPalette={sideColor(transaction.side)} variant="subtle" borderRadius="full" px="2.5" py="1">
                  {transaction.side === "buy" ? "Buy" : "Sell"}
                </Badge>
                <Text color="gray.500" fontSize="xs" truncate>{formatDateTime(transaction.executedAt)}</Text>
              </Flex>
              <Text color="gray.600" fontSize="xs">{transaction.quantity} units at {formatInvestmentAmount(transaction.unitPrice, currency)}</Text>
            </Stack>
            <Stack flexShrink="0" align="flex-end" gap="1">
              <Text color="gray.900" fontSize="sm" fontWeight="800" whiteSpace="nowrap">
                {formatInvestmentAmount(transaction.amount, currency)}
              </Text>
              <RemoveOrderDialog
                accountId={accountId}
                instrument={instrument}
                currency={currency}
                transaction={transaction}
                onDeleted={onDeleted}
              />
            </Stack>
          </Flex>
        ))}
      </Stack>
    </>
  );
}

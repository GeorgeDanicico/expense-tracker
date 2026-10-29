"use client";

import { Box, Checkbox, Flex, Input, Stack, Text } from "@chakra-ui/react";
import type { Dispatch } from "react";

import { CategorySelects } from "@/components/expenses/import/review-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/calendar";
import {
  describeDuplicate,
  descriptionProblem,
  foreignCurrencyReason,
  formatPlainAmount,
  type ReviewAction,
  type ReviewRow,
} from "@/lib/imports/review";
import { IMPORT_DESCRIPTION_MAX_LENGTH } from "@/lib/imports/types";

function ReviewCard({
  item,
  accountCurrency,
  error,
  dispatch,
}: {
  item: ReviewRow;
  accountCurrency: string;
  /** A message from the server about this row, shown until the row changes. */
  error?: string;
  dispatch: Dispatch<ReviewAction>;
}) {
  const { row, ticked } = item;
  const importable = row.importable;
  // As in the table, a description is only checked once its row is ticked.
  const message = (ticked ? descriptionProblem(item.description) : null) ?? error;
  return (
    <Box
      as="li"
      listStyleType="none"
      borderWidth="1px"
      borderColor="border"
      borderRadius="card"
      bg={ticked ? "bg.surface" : "bg.subtle"}
      px="3"
      py="3"
      data-ticked={ticked ? "" : undefined}
    >
      <Flex gap="3" align="flex-start">
        <Checkbox.Root
          size="sm"
          mt="2"
          checked={ticked}
          disabled={!importable}
          onCheckedChange={() => dispatch({ type: "toggle", id: row.id })}
        >
          <Checkbox.HiddenInput aria-label={`Add ${row.description}`} />
          <Checkbox.Control />
        </Checkbox.Root>
        <Stack flex="1" minW="0" gap="2">
          <Flex gap="3" align="flex-start">
            <Stack flex="1" minW="0" gap="0.5">
              <Input
                size="sm"
                aria-label={`Description of ${row.description}`}
                aria-invalid={message ? true : undefined}
                value={item.description}
                maxLength={IMPORT_DESCRIPTION_MAX_LENGTH}
                disabled={!importable}
                onChange={(event) => dispatch({ type: "describe", id: row.id, description: event.target.value })}
              />
              <Text textStyle="caption" color={ticked ? undefined : "fg.muted"}>
                {formatDate(row.expenseDate)}
              </Text>
            </Stack>
            <Stack gap="0.5" align="flex-end" flexShrink="0" pt="1">
              <Text as="span" textStyle="amountSm" color={ticked ? undefined : "fg.muted"}>
                {formatPlainAmount(row.amount)}
              </Text>
              {importable ? (
                <Text as="span" textStyle="caption">{row.currency}</Text>
              ) : (
                <StatusBadge tone="warning">{row.currency}</StatusBadge>
              )}
            </Stack>
          </Flex>
          {message ? <Text role="alert" textStyle="caption" color="fg.error">{message}</Text> : null}
          {row.duplicateOf ? (
            <Flex align="center" gap="1.5" wrap="wrap">
              <StatusBadge tone="warning">Possible duplicate</StatusBadge>
              <Text textStyle="caption">
                Looks like <Text as="em" fontStyle="italic">{describeDuplicate(row.duplicateOf)}</Text>
              </Text>
            </Flex>
          ) : null}
          {!importable ? (
            <Text textStyle="caption">{foreignCurrencyReason(row.currency, accountCurrency)}</Text>
          ) : null}
          <CategorySelects item={item} disabled={!importable} dispatch={dispatch} layout="inline" />
        </Stack>
      </Flex>
    </Box>
  );
}

/**
 * The draft's rows on a phone (below 768 px), one card each instead of the table: the tick box, the
 * merchant (still editable), the amount and the date on top, the category below. It shows the same
 * review state as `ReviewTable` and reports the same changes.
 */
export function ReviewCards({
  items,
  accountCurrency,
  rowErrors,
  dispatch,
}: {
  items: readonly ReviewRow[];
  accountCurrency: string;
  rowErrors: Record<string, string>;
  dispatch: Dispatch<ReviewAction>;
}) {
  return (
    <Stack as="ul" gap="2" m="0" p="0" aria-label="Transactions found in the statement">
      {items.map((item) => (
        <ReviewCard
          key={item.row.id}
          item={item}
          accountCurrency={accountCurrency}
          error={rowErrors[item.row.id]}
          dispatch={dispatch}
        />
      ))}
    </Stack>
  );
}

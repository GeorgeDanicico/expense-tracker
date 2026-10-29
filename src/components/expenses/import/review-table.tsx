"use client";

import { Box, Checkbox, Flex, Input, NativeSelect, Stack, Table, Text } from "@chakra-ui/react";
import type { Dispatch } from "react";

import { CategoryBadge, StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/calendar";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  SUBTYPE_LABELS,
  subtypesForCategory,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import {
  describeDuplicate,
  descriptionProblem,
  foreignCurrencyReason,
  formatPlainAmount,
  type ReviewAction,
  type ReviewRow,
} from "@/lib/imports/review";
import { IMPORT_DESCRIPTION_MAX_LENGTH } from "@/lib/imports/types";

/** The merchant rule's note under a car row whose category the database sets. */
export const RULE_NOTE = "Set by a merchant rule";

function CategorySelects({
  item,
  disabled,
  dispatch,
}: {
  item: ReviewRow;
  disabled: boolean;
  dispatch: Dispatch<ReviewAction>;
}) {
  const { row, category, subtype } = item;
  if (row.ruleMatched) {
    return (
      <Stack gap="0.5" align="flex-start">
        <CategoryBadge category={category} subtype={subtype} tone="color" />
        <Text textStyle="caption">{RULE_NOTE}</Text>
      </Stack>
    );
  }
  const subtypes = subtypesForCategory(category);
  return (
    <Stack gap="1">
      <NativeSelect.Root size="sm" disabled={disabled}>
        <NativeSelect.Field
          aria-label={`Category for ${row.description}`}
          value={category}
          onChange={(event) => dispatch({ type: "categorise", id: row.id, category: event.target.value as ExpenseCategory })}
        >
          {EXPENSE_CATEGORIES.map((option) => (
            <option key={option} value={option}>{CATEGORY_LABELS[option]}</option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {subtypes.length > 0 ? (
        <NativeSelect.Root size="sm" disabled={disabled}>
          <NativeSelect.Field
            aria-label={`Subtype for ${row.description}`}
            value={subtype ?? ""}
            onChange={(event) => dispatch({
              type: "subtype",
              id: row.id,
              subtype: event.target.value ? event.target.value as ExpenseSubtype : null,
            })}
          >
            <option value="">No subtype</option>
            {subtypes.map((option) => <option key={option} value={option}>{SUBTYPE_LABELS[option]}</option>)}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      ) : null}
    </Stack>
  );
}

function ReviewTableRow({
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
  // The browser's own check shows once a row is ticked, so an untouched draft isn't covered in errors.
  const problem = ticked ? descriptionProblem(item.description) : null;
  const message = problem ?? error;
  const muted = !ticked;
  return (
    <Table.Row data-ticked={ticked ? "" : undefined}>
      <Table.Cell ps="4" width="10">
        <Checkbox.Root
          size="sm"
          checked={ticked}
          disabled={!importable}
          onCheckedChange={() => dispatch({ type: "toggle", id: row.id })}
        >
          <Checkbox.HiddenInput aria-label={`Add ${row.description}`} />
          <Checkbox.Control />
        </Checkbox.Root>
      </Table.Cell>
      <Table.Cell color={muted ? "fg.muted" : undefined} whiteSpace="nowrap">{formatDate(row.expenseDate)}</Table.Cell>
      <Table.Cell py="1.5" minW="16rem">
        <Stack gap="1">
          <Input
            size="sm"
            aria-label={`Description of ${row.description}`}
            aria-invalid={message ? true : undefined}
            value={item.description}
            maxLength={IMPORT_DESCRIPTION_MAX_LENGTH}
            disabled={!importable}
            onChange={(event) => dispatch({ type: "describe", id: row.id, description: event.target.value })}
          />
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
        </Stack>
      </Table.Cell>
      <Table.Cell data-numeric color={muted ? "fg.muted" : undefined}>
        <Text as="span" textStyle="amountSm">{formatPlainAmount(row.amount)}</Text>
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap">
        {importable ? (
          <Text as="span" color="fg.muted">{row.currency}</Text>
        ) : (
          <StatusBadge tone="warning">{row.currency}</StatusBadge>
        )}
      </Table.Cell>
      <Table.Cell py="1.5" minW="11rem">
        <CategorySelects item={item} disabled={!importable} dispatch={dispatch} />
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * The draft's rows: tick box, date, description (editable), amount, currency, category and subtype.
 * It only shows the review state and reports changes; the state lives in `reviewReducer`.
 */
export function ReviewTable({
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
    <Box overflowX="auto" borderWidth="1px" borderColor="border" borderRadius="card" bg="bg.surface">
      <Table.Root size="md">
        <Table.Caption className="sr-only">Transactions found in the statement</Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader ps="4" width="10">
              <span className="sr-only">Add</span>
            </Table.ColumnHeader>
            <Table.ColumnHeader>Date</Table.ColumnHeader>
            <Table.ColumnHeader>Description</Table.ColumnHeader>
            <Table.ColumnHeader data-numeric>Amount</Table.ColumnHeader>
            <Table.ColumnHeader>Currency</Table.ColumnHeader>
            <Table.ColumnHeader>Category</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {items.map((item) => (
            <ReviewTableRow
              key={item.row.id}
              item={item}
              accountCurrency={accountCurrency}
              error={rowErrors[item.row.id]}
              dispatch={dispatch}
            />
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

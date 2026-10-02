"use client";

import {
  Badge,
  Box,
  Flex,
  Input,
  InputGroup,
  NativeSelect,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Inbox, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { CategoryVisual } from "@/components/expenses/category-visual";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type Expense,
  type ExpenseCategory,
} from "@/lib/types";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";

function EmptyState({ filtered = false }: { filtered?: boolean }) {
  return (
    <Flex minH="12rem" align="center" justify="center" px="5" py="10" textAlign="center">
      <Stack align="center" gap="3">
        <Flex width="8" height="8" align="center" justify="center" color="muted">
          {filtered ? <Search size={21} aria-hidden="true" /> : <Inbox size={22} aria-hidden="true" />}
        </Flex>
        <Stack gap="1">
          <Text fontWeight="600">{filtered ? "No matching expenses" : "No recorded expenses"}</Text>
          <Text maxW="19rem" color="muted" fontSize="sm">
            {filtered
              ? "Try another search or choose a different category."
              : "Add your first expense to start building this month’s picture."}
          </Text>
        </Stack>
      </Stack>
    </Flex>
  );
}

export function ExpenseList({
  expenses,
  currency,
  compact = false,
  allowDelete = false,
}: {
  expenses: Expense[];
  currency: string;
  compact?: boolean;
  allowDelete?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | "all">("all");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const filtered = useMemo(() => {
    if (compact) return expenses.slice(0, 5);

    return expenses.filter((expense) => {
      const categoryMatches = category === "all" || expense.category === category;
      const queryMatches =
        !deferredQuery ||
        expense.description.toLocaleLowerCase().includes(deferredQuery) ||
        expense.notes?.toLocaleLowerCase().includes(deferredQuery) ||
        CATEGORY_LABELS[expense.category].toLocaleLowerCase().includes(deferredQuery);
      return categoryMatches && Boolean(queryMatches);
    });
  }, [category, compact, deferredQuery, expenses]);

  if (!expenses.length) return <EmptyState />;

  return (
    <>
      {compact ? null : (
        <Flex
          align={{ base: "stretch", sm: "center" }}
          justify="space-between"
          gap="3"
          direction={{ base: "column", sm: "row" }}
          px={{ base: "5", md: "6" }}
          py="4"
          borderBottomWidth="1px"
          borderColor="canvas"
        >
          <InputGroup
            maxW={{ sm: "22rem" }}
            startElement={<Search size={17} color="#8b8d98" aria-hidden="true" />}
          >
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search expenses"
              aria-label="Search expenses"
              borderRadius="xl"
              bg="canvas"
              borderColor="border"
            />
          </InputGroup>
          <Flex align="center" gap="3">
            <Text color="muted" fontSize="sm" whiteSpace="nowrap">
              {filtered.length} of {expenses.length}
            </Text>
            <NativeSelect.Root size="sm" maxW="11rem">
              <NativeSelect.Field
                value={category}
                onChange={(event) => setCategory(event.target.value as ExpenseCategory | "all")}
                aria-label="Filter by category"
                borderRadius="lg"
                bg="white"
              >
                <option value="all">All categories</option>
                {EXPENSE_CATEGORIES.map((option) => (
                  <option key={option} value={option}>{CATEGORY_LABELS[option]}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Flex>
        </Flex>
      )}

      {!filtered.length ? <EmptyState filtered /> : (
        <>
          <Box display={{ base: "none", md: "block" }} overflowX="auto">
            <Table.Root size="sm" variant="line">
              <Table.Caption className="sr-only">Expense transactions</Table.Caption>
              <Table.Header>
                <Table.Row bg="canvas">
                  <Table.ColumnHeader pl="6" py="3.5" color="muted" fontSize="xs" fontWeight="600" letterSpacing="0.06em">TRANSACTION</Table.ColumnHeader>
                  <Table.ColumnHeader py="3.5" color="muted" fontSize="xs" fontWeight="600" letterSpacing="0.06em">DATE</Table.ColumnHeader>
                  <Table.ColumnHeader py="3.5" color="muted" fontSize="xs" fontWeight="600" letterSpacing="0.06em">CATEGORY</Table.ColumnHeader>
                  <Table.ColumnHeader py="3.5" color="muted" fontSize="xs" fontWeight="600" letterSpacing="0.06em" textAlign="end">AMOUNT</Table.ColumnHeader>
                  {allowDelete ? <Table.ColumnHeader width="14" pr="5"><span className="sr-only">Actions</span></Table.ColumnHeader> : null}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {filtered.map((expense) => (
                  <Table.Row key={expense.id} _hover={{ bg: "selected" }} transition="background 140ms ease">
                    <Table.Cell pl="6" py="4">
                      <Flex align="center" gap="3">
                        <CategoryVisual category={expense.category} />
                        <Stack minW="0" gap="0.5">
                          <Text maxW={{ md: "16rem", xl: "25rem" }} fontWeight="600" truncate>{expense.description}</Text>
                          {expense.notes ? <Text maxW={{ md: "16rem", xl: "25rem" }} color="muted" fontSize="xs" truncate>{expense.notes}</Text> : null}
                        </Stack>
                      </Flex>
                    </Table.Cell>
                    <Table.Cell color="muted" whiteSpace="nowrap">{formatDate(expense.expenseDate)}</Table.Cell>
                    <Table.Cell>
                      <Badge colorPalette="purple" variant="subtle" borderRadius="full" px="2.5" py="1">
                        {CATEGORY_LABELS[expense.category]}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell textAlign="end" color="fg" fontSize="sm" fontWeight="600" whiteSpace="nowrap">
                      {formatCurrency(expense.amount, currency)}
                    </Table.Cell>
                    {allowDelete ? (
                      <Table.Cell pr="5" textAlign="end">
                        <DeleteExpenseButton id={expense.id} description={expense.description} />
                      </Table.Cell>
                    ) : null}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>

          <Stack
            display={{ base: "flex", md: "none" }}
            gap="0"
            px={compact ? "4" : "3"}
            pb="2"
          >
            {filtered.map((expense) => (
              <Flex
                key={expense.id}
                align="center"
                gap="3"
                px="2"
                py="3.5"
                borderBottomWidth="1px"
                borderColor="canvas"
                _last={{ borderBottomWidth: "0" }}
              >
                <CategoryVisual category={expense.category} />
                <Stack flex="1" minW="0" gap="0.5">
                  <Text fontSize="sm" fontWeight="600" truncate>{expense.description}</Text>
                  <Text color="muted" fontSize="xs" truncate>
                    {formatDate(expense.expenseDate)} · {CATEGORY_LABELS[expense.category]}
                  </Text>
                  {expense.notes ? <Text color="muted" fontSize="xs" truncate>{expense.notes}</Text> : null}
                </Stack>
                <Stack flexShrink="0" align="flex-end" gap="1">
                  <Text fontSize="sm" fontWeight="600" whiteSpace="nowrap">{formatCurrency(expense.amount, currency)}</Text>
                  {allowDelete ? <DeleteExpenseButton id={expense.id} description={expense.description} /> : null}
                </Stack>
              </Flex>
            ))}
          </Stack>
        </>
      )}
    </>
  );
}

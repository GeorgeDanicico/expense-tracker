"use client";

import { Flex, Input, InputGroup, NativeSelect, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/expenses/categories";

/** Search + category filter row above the main expense list. */
export function ExpenseFilters({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  shown,
  total,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  category: ExpenseCategory | "all";
  onCategoryChange: (category: ExpenseCategory | "all") => void;
  shown: number;
  total: number;
}) {
  return (
    <Flex
      align={{ base: "stretch", sm: "center" }}
      justify="space-between"
      gap="2"
      direction={{ base: "column", sm: "row" }}
      px="4"
      py="3"
      borderBottomWidth="1px"
      borderColor="border"
    >
      <InputGroup
        flex="1"
        maxW={{ sm: "20rem" }}
        startElement={<Search size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />}
        startElementProps={{ color: "fg.subtle" }}
      >
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search expenses"
          aria-label="Search expenses"
        />
      </InputGroup>
      <Flex align="center" gap="3" justify="space-between">
        <Text textStyle="caption" whiteSpace="nowrap" aria-live="polite">
          {shown} of {total}
        </Text>
        <NativeSelect.Root width="11rem" flexShrink="0">
          <NativeSelect.Field
            value={category}
            onChange={(event) => onCategoryChange(event.target.value as ExpenseCategory | "all")}
            aria-label="Filter by category"
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
  );
}

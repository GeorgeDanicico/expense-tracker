"use client";

import { Box, Button, Flex, Tabs } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { ExpenseTab } from "@/lib/expenses/tabs";

export const MAIN_EXPENSE_TAB = "main";

export function ExpenseTabs({
  tabs,
  value,
  onValueChange,
  onCreate,
  children,
}: {
  tabs: ExpenseTab[];
  value: string;
  onValueChange: (value: string) => void;
  onCreate: () => void;
  children: ReactNode;
}) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={({ value: nextValue }) => onValueChange(nextValue)}
      lazyMount
    >
      <Flex align="center" gap="3" minW="0" mb="3">
        <Box flex="1" minW="0" overflowX="auto" overscrollBehaviorX="contain">
          <Tabs.List
            aria-label="Expense tabs"
            width="max-content"
            minW="full"
            borderColor="border"
            gap="1"
          >
            <Tabs.Trigger
              value={MAIN_EXPENSE_TAB}
              minH="11"
              px="4"
              whiteSpace="nowrap"
              color="muted"
              _selected={{ color: "accent", borderColor: "accent" }}
            >
              Expenses
            </Tabs.Trigger>
            {tabs.map((tab) => (
              <Tabs.Trigger
                key={tab.id}
                value={tab.id}
                minH="11"
                maxW="14rem"
                px="4"
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
                color="muted"
                _selected={{ color: "accent", borderColor: "accent" }}
              >
                {tab.name}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Box>
        <Button
          flexShrink="0"
          minH="11"
          variant="outline"
          borderRadius="xl"
          onClick={onCreate}
          aria-label="Create expense tab"
        >
          <Plus size={17} aria-hidden="true" />
          <Box display={{ base: "none", sm: "inline" }}>New tab</Box>
        </Button>
      </Flex>
      {children}
    </Tabs.Root>
  );
}

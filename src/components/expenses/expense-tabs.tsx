"use client";

import { Box, Button, Flex, Tabs } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
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
  /** Omitted while viewing another member: their tabs can be opened but not added to. */
  onCreate?: () => void;
  children: ReactNode;
}) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={({ value: nextValue }) => onValueChange(nextValue)}
      lazyMount
    >
      <Flex align="flex-end" gap="2" minW="0" mb="4" borderBottomWidth="1px" borderColor="border">
        <Box flex="1" minW="0" overflowX="auto" overflowY="hidden" overscrollBehaviorX="contain" mb="-1px">
          <Tabs.List aria-label="Expense tabs" width="max-content" minW="full" borderBottomWidth="0">
            <Tabs.Trigger value={MAIN_EXPENSE_TAB}>Expenses</Tabs.Trigger>
            {tabs.map((tab) => (
              <Tabs.Trigger key={tab.id} value={tab.id} maxW="14rem">
                <Box as="span" overflow="hidden" textOverflow="ellipsis">{tab.name}</Box>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Box>
        {onCreate ? (
          <Button
            flexShrink="0"
            mb="1"
            size="xs"
            variant="ghost"
            color="fg.muted"
            onClick={onCreate}
            aria-label="Create expense tab"
          >
            <Plus size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <Box as="span" display={{ base: "none", sm: "inline" }}>New tab</Box>
          </Button>
        ) : null}
      </Flex>
      {children}
    </Tabs.Root>
  );
}

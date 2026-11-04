"use client";

import { Box } from "@chakra-ui/react";
import { Plus, SlidersHorizontal } from "lucide-react";

import { ChipRow } from "@/components/ui/chip-menu";
import { ICON } from "@/components/ui/icon";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { ExpenseTab } from "@/lib/expenses/tabs";

export const MAIN_EXPENSE_TAB = "main";

/**
 * The saved tabs as a sideways-scrolling row of chips: All (the month's ledger), each tab, "+ Tab"
 * (left out while read-only) and Filters, which shows the open ledger's filters.
 */
export function ExpenseTabChips({
  tabs,
  value,
  onValueChange,
  onCreate,
  filtersOpen,
  onFiltersOpenChange,
}: {
  tabs: readonly ExpenseTab[];
  value: string;
  onValueChange: (value: string) => void;
  /** Omitted while viewing another member: their tabs can be opened but not added to. */
  onCreate?: () => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
}) {
  return (
    <ChipRow label="Expense tabs">
      <ToggleChip flexShrink="0" pressed={value === MAIN_EXPENSE_TAB} onClick={() => onValueChange(MAIN_EXPENSE_TAB)}>
        All
      </ToggleChip>
      {tabs.map((tab) => (
        <ToggleChip key={tab.id} flexShrink="0" maxW="14rem" pressed={value === tab.id} onClick={() => onValueChange(tab.id)}>
          <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
            {tab.name}
          </Box>
        </ToggleChip>
      ))}
      {onCreate ? (
        <ToggleChip flexShrink="0" onClick={onCreate} aria-label="New expense tab">
          <Plus size={ICON.xs} aria-hidden="true" /> Tab
        </ToggleChip>
      ) : null}
      <ToggleChip flexShrink="0" pressed={filtersOpen} onClick={() => onFiltersOpenChange(!filtersOpen)}>
        <SlidersHorizontal size={ICON.xs} aria-hidden="true" /> Filters
      </ToggleChip>
    </ChipRow>
  );
}

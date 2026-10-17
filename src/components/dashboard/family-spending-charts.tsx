"use client";

import { Box, chakra, Flex, Stack, Text, VisuallyHidden } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";

import { useMemberColors } from "@/hooks/use-member-colors";
import { formatMonth } from "@/lib/calendar";
import { categoryBars, trendColumns, type Segment } from "@/lib/expenses/family-charts";
import type { FamilyDashboardMember } from "@/lib/expenses/types";
import { formatCurrency } from "@/lib/utils/currency";

// Plain-CSS charts for the family dashboard. Every segment is a button: it shows a tooltip on hover and
// on keyboard focus, and selecting it picks that member for the whole dashboard. Segments are told
// apart by a 2px gap, and each carries the member's name in its label, so colour never identifies alone.

const GAP = "2px";
const NO_COLOR = "fg.subtle";

type Align = "start" | "center" | "end";

/** Keeps a tooltip inside the card: near the left edge it opens rightwards, near the right edge leftwards. */
function alignAt(fraction: number): Align {
  return fraction < 0.25 ? "start" : fraction > 0.75 ? "end" : "center";
}

const TOOLTIP_POSITION = {
  start: { left: "0" },
  center: { left: "50%", transform: "translateX(-50%)" },
  end: { right: "0" },
} as const;

type SegmentProps = {
  id: string;
  segment: Segment;
  /** Heading line of the tooltip and part of the accessible name, e.g. the month or the category. */
  context: string;
  currency: string;
  active: string | null;
  onActive: (id: string | null) => void;
  selected: string | null;
  onSelect: (memberId: string | null) => void;
  align: Align;
  /** Proportional size along the bar's main axis. */
  weight: number;
  vertical?: boolean;
};

function SegmentButton({
  id, segment, context, currency, active, onActive, selected, onSelect, align, weight, vertical = false,
}: SegmentProps) {
  const memberColor = useMemberColors();
  const isSelected = selected === segment.memberId;
  const dimmed = selected !== null && !isSelected;
  const amount = formatCurrency(segment.total, currency);
  return (
    <chakra.button
      type="button"
      position="relative"
      flex={`${weight} 1 0`}
      minW={vertical ? undefined : "1"}
      minH={vertical ? "1" : undefined}
      bg={memberColor(segment.memberId) ?? NO_COLOR}
      borderRadius="sm"
      cursor="pointer"
      opacity={dimmed ? 0.3 : 1}
      transition="opacity 0.15s"
      aria-pressed={isSelected}
      aria-label={`${segment.name}, ${context}, ${amount}`}
      onClick={() => onSelect(isSelected ? null : segment.memberId)}
      onMouseEnter={() => onActive(id)}
      onMouseLeave={() => onActive(null)}
      onFocus={() => onActive(id)}
      onBlur={() => onActive(null)}
      _focusVisible={{ outline: "2px solid", outlineColor: "fg", outlineOffset: "1px", zIndex: 1 }}
    >
      {active === id ? (
        <Box
          aria-hidden="true"
          role="tooltip"
          position="absolute"
          bottom="100%"
          mb="1"
          zIndex="tooltip"
          px="2.5"
          py="1.5"
          bg="bg"
          color="fg"
          borderWidth="1px"
          borderColor="border"
          borderRadius="control"
          boxShadow="md"
          textAlign="left"
          whiteSpace="nowrap"
          pointerEvents="none"
          {...TOOLTIP_POSITION[align]}
        >
          <Text textStyle="label">{segment.name}</Text>
          <Text textStyle="caption">{context}</Text>
          <Text textStyle="amountSm">{amount}</Text>
        </Box>
      ) : null}
    </chakra.button>
  );
}

type ChartProps = {
  members: FamilyDashboardMember[];
  currency: string;
  selected: string | null;
  onSelect: (memberId: string | null) => void;
};

/** A table of the same figures, for screen readers. */
function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <VisuallyHidden asChild>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </VisuallyHidden>
  );
}

function shortMonth(key: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${key}-01T12:00:00Z`));
}

/** Stacked columns: one per month (the last completed months, then this one), one segment per member. */
export function MonthlyTrendChart({ members, currency, selected, onSelect, currentMonth }: ChartProps & { currentMonth: string }) {
  const [active, setActive] = useState<string | null>(null);
  const columns = trendColumns(members);
  const max = Math.max(...columns.map((column) => column.total), 1);
  if (!columns.length) return <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>;
  return (
    <Stack gap="3">
      <Flex gap="3" align="stretch" role="group" aria-label="Spending by month, split by member">
        {columns.map((column, columnIndex) => {
          const label = column.key === currentMonth ? "This month" : shortMonth(column.key);
          const segments = column.segments.filter((segment) => segment.total > 0);
          const align = alignAt(columns.length > 1 ? columnIndex / (columns.length - 1) : 0.5);
          return (
            <Flex key={column.key} direction="column" align="stretch" flex="1" minW="0" gap="1.5">
              <Flex direction="column" justify="flex-end" h="40" gap="1">
                <Text textStyle="caption" textAlign="center" truncate>{formatCurrency(column.total, currency)}</Text>
                <Flex
                  direction="column-reverse"
                  gap={GAP}
                  h={`${(column.total / max) * 85}%`}
                  minH={column.total > 0 ? "1" : undefined}
                >
                  {segments.map((segment) => (
                    <SegmentButton
                      key={segment.memberId}
                      id={`${column.key}:${segment.memberId}`}
                      segment={segment}
                      context={formatMonth(column.key)}
                      currency={currency}
                      active={active}
                      onActive={setActive}
                      selected={selected}
                      onSelect={onSelect}
                      align={align}
                      weight={segment.total}
                      vertical
                    />
                  ))}
                </Flex>
              </Flex>
              <Text textStyle="caption" textAlign="center" borderTopWidth="1px" borderColor="border" pt="1.5">{label}</Text>
            </Flex>
          );
        })}
      </Flex>
      <DataTable
        caption="Spending by month, split by member"
        columns={["Month", ...members.map((member) => member.name), "Total"]}
        rows={columns.map((column) => [
          formatMonth(column.key),
          ...column.segments.map((segment) => formatCurrency(segment.total, currency)),
          formatCurrency(column.total, currency),
        ])}
      />
    </Stack>
  );
}

/** One horizontal bar per category, biggest first, each split by member. */
export function CategoryBreakdownChart({ members, currency, selected, onSelect }: ChartProps) {
  const [active, setActive] = useState<string | null>(null);
  const bars = categoryBars(members);
  const max = Math.max(...bars.map((bar) => bar.total), 1);
  if (!bars.length) return <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>;
  return (
    <Stack gap="3">
      <Stack as="ul" gap="3" m="0" p="0" listStyleType="none" aria-label="Spending by category, split by member">
        {bars.map((bar) => {
          let before = 0;
          return (
            <Stack as="li" key={bar.category} gap="1">
              <Flex justify="space-between" align="baseline" gap="2">
                <Text textStyle="bodySm" truncate>{bar.label}</Text>
                <Text textStyle="amountSm">{formatCurrency(bar.total, currency)}</Text>
              </Flex>
              <Flex gap={GAP} h="3" w={`${(bar.total / max) * 100}%`} minW="2">
                {bar.segments.map((segment) => {
                  const center = (before + segment.total / 2) / bar.total;
                  before += segment.total;
                  return (
                    <SegmentButton
                      key={segment.memberId}
                      id={`${bar.category}:${segment.memberId}`}
                      segment={segment}
                      context={bar.label}
                      currency={currency}
                      active={active}
                      onActive={setActive}
                      selected={selected}
                      onSelect={onSelect}
                      align={alignAt((center * bar.total) / max)}
                      weight={segment.total}
                    />
                  );
                })}
              </Flex>
            </Stack>
          );
        })}
      </Stack>
      <DataTable
        caption="Spending by category, split by member"
        columns={["Category", ...members.map((member) => member.name), "Total"]}
        rows={bars.map((bar) => [
          bar.label,
          ...members.map((member) => formatCurrency(bar.segments.find((segment) => segment.memberId === member.memberId)?.total ?? 0, currency)),
          formatCurrency(bar.total, currency),
        ])}
      />
    </Stack>
  );
}

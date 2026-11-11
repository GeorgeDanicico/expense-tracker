"use client";

// eslint-disable-next-line local/lazy-popper -- a dev-only mockup page, not part of any shipped page's first load
import { Box, Flex, Grid, Menu, Portal, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight, Download, FileUp, MoreHorizontal, SlidersHorizontal, Tags } from "lucide-react";
import { useState } from "react";

import { Amount, Card, ChipMenu, ChipRow, EmptyState, ICON, IconButton, SegmentedControl, ToggleChip } from "@/components/ui";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { transition } from "@/components/ui/theme/motion";
import { CATEGORY_LABELS, type ExpenseCategory } from "@/lib/expenses/categories";
import { formatCurrency } from "@/lib/utils/currency";

import { useMockState } from "../mock-state";
import { MOCK_CURRENCY, MOCK_EXPENSE_TABS, MOCK_MEMBERS, MOCK_MONTH, type MockExpense } from "../mockup-data";
import { CategoryTile, ExpenseRow, GroupLabel, PageTitle, Rows } from "../mockup-parts";
import { SwipeRow } from "../stand-ins";

const SECTIONS = [
  { value: "expenses", label: "Expenses" },
  { value: "investments", label: "Investments" },
  { value: "net-worth", label: "Net worth" },
] as const;
type Section = (typeof SECTIONS)[number]["value"];

const MONTHS = ["September 2026", "October 2026", "November 2026"];

/** Money: Expenses, Investments and Net worth behind one segmented control. Expenses is mocked. */
export function MoneyMockup() {
  const [section, setSection] = useState<Section>("expenses");
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <PageTitle title="Money" action={<MoneyMenu />} />
      <Box alignSelf={{ md: "flex-start" }}>
        <SegmentedControl aria-label="Money section" items={SECTIONS} value={section} onValueChange={setSection} fullWidth={{ base: true, md: false }} />
      </Box>
      {section === "expenses" ? (
        <ExpensesSection />
      ) : (
        <Card>
          <EmptyState title={`${SECTIONS.find((item) => item.value === section)?.label} isn't mocked in U3`} description="It moves under Money in U9 with the same rows, row actions and sheets as Expenses." />
        </Card>
      )}
    </Stack>
  );
}

/** Export and import live behind ⋯: one primary action per screen, and that's the + . */
function MoneyMenu() {
  const { showToast } = useMockState();
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }} onSelect={({ value }) => showToast({ message: `${value} (not in the mockup)` })}>
      <Menu.Trigger asChild>
        <IconButton aria-label="More options" variant="outline">
          <MoreHorizontal size={ICON.sm} />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="52">
            <Menu.Item value="Import a statement">
              <FileUp size={ICON.sm} aria-hidden="true" /> Import a statement
            </Menu.Item>
            <Menu.Item value="Export">
              <Download size={ICON.sm} aria-hidden="true" /> Export this month
            </Menu.Item>
            <Menu.Item value="Manage tabs">
              <Tags size={ICON.sm} aria-hidden="true" /> Manage tabs
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

function byDay(expenses: MockExpense[]) {
  const groups = new Map<string, MockExpense[]>();
  for (const expense of expenses) groups.set(expense.day, [...(groups.get(expense.day) ?? []), expense]);
  return [...groups];
}

function ExpensesSection() {
  const { expenses, removed, total } = useMockState();
  const [month, setMonth] = useState(MONTHS.length - 1);
  const [tab, setTab] = useState(MOCK_EXPENSE_TABS[0]);
  const visible = expenses.filter((expense) => !removed.has(expense.id));
  const current = month === MONTHS.length - 1;

  return (
    <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 1fr) 20rem" }} gap={PAGE_SPACING.columnGap} alignItems="start">
      <Stack gap="3" minW="0">
        <Flex align="center" gap="1">
          <IconButton aria-label="Previous month" disabled={month === 0} onClick={() => setMonth(month - 1)}>
            <ChevronLeft size={ICON.nav} />
          </IconButton>
          <Text textStyle="sectionTitle" minW="9rem" textAlign="center" aria-live="polite">
            {MONTHS[month]}
          </Text>
          <IconButton aria-label="Next month" disabled={current} onClick={() => setMonth(month + 1)}>
            <ChevronRight size={ICON.nav} />
          </IconButton>
          <Box flex="1" />
          <ChipMenu
            label={
              <Flex as="span" align="center" gap="1.5">
                <Box as="span" boxSize="2" borderRadius="full" bg="member.1" aria-hidden="true" /> Me
              </Flex>
            }
            items={[...MOCK_MEMBERS.map((member) => ({ value: member.id, label: member.id === "ana" ? "Me" : member.name })), { value: "all", label: "Everyone" }]}
          />
        </Flex>
        <ChipRow label="Expense tabs">
          {MOCK_EXPENSE_TABS.map((name) => (
            <ToggleChip key={name} pressed={name === tab} onClick={() => setTab(name)}>
              {name}
            </ToggleChip>
          ))}
          <ToggleChip>+ Tab</ToggleChip>
          <ToggleChip>
            <SlidersHorizontal size={ICON.xs} aria-hidden="true" /> Filters
          </ToggleChip>
        </ChipRow>
        {current ? (
          <>
            <Text textStyle="bodySm" color="fg.muted">
              <Text as="span" fontWeight="semibold" color="fg">
                {formatCurrency(total, MOCK_CURRENCY)}
              </Text>{" "}
              · {visible.length} expenses · {Math.abs(MOCK_MONTH.changePercent)}% less than October so far
            </Text>
            <Card>
              <Card.Body>
                <Stack gap="1">
                  {byDay(expenses).map(([day, rows]) => (
                    <Box key={day}>
                      {rows.some((row) => !removed.has(row.id)) ? <GroupLabel>{day}</GroupLabel> : null}
                      <Rows>
                        {rows.map((expense) => (
                          <ExpenseRow key={expense.id} expense={expense} showMember={false} wrap={(row) => <SwipeToDelete expense={expense}>{row}</SwipeToDelete>} />
                        ))}
                      </Rows>
                    </Box>
                  ))}
                </Stack>
              </Card.Body>
            </Card>
            <Text textStyle="caption" textAlign="center" display={{ md: "none" }}>
              Swipe a row left to delete it; Undo is on the toast.
            </Text>
          </>
        ) : (
          <Card>
            <EmptyState title={`Nothing in ${MONTHS[month]} in this mockup`} description="Only November has sample expenses." />
          </Card>
        )}
      </Stack>
      <Box display={{ base: "none", lg: "block" }}>
        <ByCategory expenses={visible} />
      </Box>
    </Grid>
  );
}

function SwipeToDelete({ expense, children }: { expense: MockExpense; children: React.ReactNode }) {
  const { removed, removeExpense, restoreExpense, showToast } = useMockState();
  return (
    <SwipeRow
      gone={removed.has(expense.id)}
      left={{ label: "Delete", tone: "negative", commit: true }}
      onSwipe={() => {
        removeExpense(expense.id);
        showToast({ message: "Expense deleted", action: "Undo", onAction: () => restoreExpense(expense.id) });
      }}
    >
      {children}
    </SwipeRow>
  );
}

/** Desktop only: where the month went, next to the list. The full charts are Insights. */
function ByCategory({ expenses }: { expenses: MockExpense[] }) {
  const totals = new Map<ExpenseCategory, number>();
  for (const expense of expenses) totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const largest = sorted[0]?.[1] ?? 1;
  return (
    <Card>
      <Card.Header title="By category" description="November so far" />
      <Card.Body>
        <Stack gap="3">
          {sorted.map(([category, amount]) => (
            <Flex key={category} align="center" gap="3">
              <CategoryTile category={category} />
              <Stack gap="1" flex="1" minW="0">
                <Flex justify="space-between" gap="2">
                  <Text textStyle="bodySm" fontWeight="medium">
                    {CATEGORY_LABELS[category]}
                  </Text>
                  <Amount value={amount} currency={MOCK_CURRENCY} size="sm" />
                </Flex>
                <Box height="1.5" bg="bg.muted" borderRadius="pill" overflow="hidden" aria-hidden="true">
                  <Box height="full" bg="chart.bar" transformOrigin="left" transform={`scaleX(${amount / largest})`} transition={transition("transform", "slow")} />
                </Box>
              </Stack>
            </Flex>
          ))}
        </Stack>
      </Card.Body>
    </Card>
  );
}

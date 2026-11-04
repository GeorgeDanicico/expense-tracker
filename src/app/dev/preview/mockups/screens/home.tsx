"use client";

import { Box, Button, Flex, Grid, Menu, Portal, Stack, Text } from "@chakra-ui/react";
import { AlarmClock, Check, SquareKanban } from "lucide-react";
import { useState } from "react";

import { Avatar, Card, Collapse, ICON, IconButton, IconTile, StatusBadge } from "@/components/ui";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { transition } from "@/components/ui/theme/motion";
import { formatCurrency } from "@/lib/utils/currency";

import { useIdSet, useMockState } from "../mock-state";
import { MOCK_CURRENCY, MOCK_DATE, MOCK_ME, MOCK_MONTH, MOCK_REMINDERS, MOCK_SNOOZE_CHOICES, MOCK_TODOS, MOCK_TODO_COLUMNS } from "../mockup-data";
import { ExpenseRow, MemberDot, PageTitle, ReminderTile, Rows, SectionLink } from "../mockup-parts";
import { useCountUp, useMotionDelay } from "../motion-scope";
import { MockRow } from "../stand-ins";

/**
 * Home is "today": what's due with Done on the row, this month against last, the latest expenses and
 * the family's to-dos for you. One column on a phone, two from `lg`.
 */
export function HomeMockup() {
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <PageTitle kicker={MOCK_DATE} title="Good morning, Ana" action={<Avatar name={MOCK_ME.fullName} color="member.1" size="md" />} />
      <Grid
        gap={PAGE_SPACING.columnGap}
        alignItems="start"
        templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 1.15fr) minmax(0, 1fr)" }}
        templateAreas={{ base: `"month" "due" "recent" "todos"`, lg: `"month due" "recent due" "recent todos"` }}
      >
        <Box gridArea="month">
          <MonthCard />
        </Box>
        <Box gridArea="due">
          <DueToday />
        </Box>
        <Box gridArea="recent">
          <RecentExpenses />
        </Box>
        <Box gridArea="todos">
          <FamilyTodos />
        </Box>
      </Grid>
    </Stack>
  );
}

function MonthCard() {
  const { total } = useMockState();
  const shown = useCountUp(total);
  const share = Math.min(1, total / MOCK_MONTH.previousTotal);
  return (
    <Card>
      <Card.Header title={`Spent in ${MOCK_MONTH.label}`} actions={<SectionLink href="money-expenses">Insights</SectionLink>} />
      <Card.Body>
        <Stack gap="3">
          <Flex align="baseline" gap="2.5" wrap="wrap">
            <Text textStyle="amountHero" aria-live="polite">
              {formatCurrency(shown, MOCK_CURRENCY)}
            </Text>
            <StatusBadge tone="positive">↓ {Math.abs(MOCK_MONTH.changePercent)}% vs {MOCK_MONTH.previous}</StatusBadge>
          </Flex>
          <Box height="2" borderRadius="pill" bg="bg.muted" overflow="hidden" aria-hidden="true">
            <Box
              height="full"
              bg="chart.bar"
              borderRadius="pill"
              transformOrigin="left"
              transform={`scaleX(${share})`}
              transition={transition("transform", "slow")}
            />
          </Box>
          <Text textStyle="caption">
            {Math.round(share * 100)}% of {MOCK_MONTH.previous}&apos;s total, four days in.
          </Text>
        </Stack>
      </Card.Body>
    </Card>
  );
}

function DueToday() {
  const { showToast } = useMockState();
  const [cleared, toggle] = useIdSet();
  const [ticking, setTicking] = useState<string | null>(null);
  const later = useMotionDelay();
  const due = MOCK_REMINDERS.filter((reminder) => reminder.group === "Today");
  const done = (id: string) => {
    setTicking(id);
    later(250, () => {
      setTicking(null);
      toggle(id, true);
      showToast({ message: "Marked done", action: "Undo", onAction: () => toggle(id, false) });
    });
  };
  const snooze = (id: string, label: string) => {
    toggle(id, true);
    showToast({ message: `Snoozed ${label.toLowerCase()}`, action: "Undo", onAction: () => toggle(id, false) });
  };
  const allDone = due.every((reminder) => cleared.has(reminder.id));

  return (
    <Card>
      <Card.Header title="Due today" actions={<SectionLink href="planning-reminders">All reminders</SectionLink>} />
      <Card.Body>
        <Rows>
          {due.map((reminder) => (
            <Collapse key={reminder.id} open={!cleared.has(reminder.id)}>
              <MockRow
                leading={<ReminderTile reminder={reminder} />}
                title={reminder.title}
                meta={reminder.when}
                metaTone={reminder.overdue ? "error" : undefined}
                trailing={
                  <>
                    <Menu.Root positioning={{ placement: "bottom-end" }} onSelect={({ value }) => snooze(reminder.id, value)}>
                      <Menu.Trigger asChild>
                        <IconButton aria-label={`Snooze ${reminder.title}`} tooltip>
                          <AlarmClock size={ICON.sm} />
                        </IconButton>
                      </Menu.Trigger>
                      <Portal>
                        <Menu.Positioner>
                          <Menu.Content minW="52">
                            {MOCK_SNOOZE_CHOICES.map((choice) => (
                              <Menu.Item key={choice} value={choice}>
                                {choice}
                              </Menu.Item>
                            ))}
                          </Menu.Content>
                        </Menu.Positioner>
                      </Portal>
                    </Menu.Root>
                    <Button
                      size="sm"
                      variant="solid"
                      colorPalette={ticking === reminder.id ? "success" : "brand"}
                      aria-label={`Mark ${reminder.title} done`}
                      onClick={() => done(reminder.id)}
                    >
                      {ticking === reminder.id ? <Check size={ICON.sm} aria-hidden="true" /> : "Done"}
                    </Button>
                  </>
                }
              />
            </Collapse>
          ))}
          {allDone ? (
            <Text textStyle="body" color="fg.muted" px="2" py="3">
              Nothing else due today. Next: Renew car insurance, Thu 5.
            </Text>
          ) : null}
        </Rows>
      </Card.Body>
    </Card>
  );
}

function RecentExpenses() {
  const { expenses } = useMockState();
  return (
    <Card>
      <Card.Header title="Recent expenses" actions={<SectionLink href="money-expenses">Expenses</SectionLink>} />
      <Card.Body>
        <Rows>
          {expenses.slice(0, 5).map((expense) => (
            <ExpenseRow key={expense.id} expense={expense} phoneMenu={false} />
          ))}
        </Rows>
      </Card.Body>
    </Card>
  );
}

function FamilyTodos() {
  const mine = MOCK_TODOS.filter((todo) => todo.assignee === "ana" && todo.column !== "done");
  const column = (value: string) => MOCK_TODO_COLUMNS.find((item) => item.value === value)?.label;
  return (
    <Card>
      <Card.Header title="Family to-dos for you" actions={<SectionLink href="planning-todos">Board</SectionLink>} />
      <Card.Body>
        <Rows>
          {mine.map((todo) => (
            <MockRow
              key={todo.id}
              leading={<IconTile icon={SquareKanban} bg="bg.muted" color="fg.muted" />}
              title={todo.title}
              meta={
                <Flex as="span" gap="1" align="center">
                  {column(todo.column)}
                  {todo.due ? ` · ${todo.due}` : null}
                  <span aria-hidden="true">·</span> from <MemberDot id="mihai" />
                </Flex>
              }
            />
          ))}
        </Rows>
      </Card.Body>
    </Card>
  );
}

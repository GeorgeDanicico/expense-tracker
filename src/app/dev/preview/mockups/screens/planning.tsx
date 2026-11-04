"use client";

import { Box, Button, Flex, Grid, Input, Stack, Text } from "@chakra-ui/react";
import { AlarmClock, ArrowRightLeft, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { AppDialog, Avatar, Card, Collapse, Disclosure, EmptyState, ICON, RowActions, SegmentedControl, ToggleChip } from "@/components/ui";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { revealRowActions } from "@/components/ui/theme/recipes/misc";

import { useIdSet, useMockState } from "../mock-state";
import { memberById, MOCK_EVENTS, MOCK_REMINDERS, MOCK_SNOOZE_CHOICES, MOCK_TODO_COLUMNS, MOCK_TODOS, type MockReminder, type MockTodo, type MockTodoColumn } from "../mockup-data";
import { GroupLabel, MemberDot, PageTitle, ReminderTile, Rows } from "../mockup-parts";
import { ChipMenu, ChipRow, MockRow, SwipeRow } from "../stand-ins";

const SECTIONS = [
  { value: "reminders", label: "Reminders" },
  { value: "todos", label: "To-dos" },
  { value: "calendar", label: "Calendar" },
] as const;
type Section = (typeof SECTIONS)[number]["value"];

/** Planning: Reminders, To-dos and Calendar behind one segmented control (Reminders alone without a family). */
export function PlanningMockup({ initial }: { initial: Section }) {
  const [section, setSection] = useState<Section>(initial);
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <PageTitle title="Planning" />
      <Box alignSelf={{ md: "flex-start" }}>
        <SegmentedControl aria-label="Planning section" items={SECTIONS} value={section} onValueChange={setSection} fullWidth={{ base: true, md: false }} />
      </Box>
      {section === "reminders" ? <RemindersSection /> : null}
      {section === "todos" ? <TodosSection /> : null}
      {section === "calendar" ? (
        <Card>
          <EmptyState title="Calendar isn't mocked in U3" description="U10 decides Agenda or Week for phones (see the open questions)." />
        </Card>
      ) : null}
    </Stack>
  );
}

function RemindersSection() {
  const { showToast } = useMockState();
  const [cleared, setCleared] = useIdSet();
  const [snoozing, setSnoozing] = useState<MockReminder | null>(null);
  const act = (reminder: MockReminder, message: string) => {
    setCleared(reminder.id, true);
    showToast({ message, action: "Undo", onAction: () => setCleared(reminder.id, false) });
  };
  const groups = (["Today", "Upcoming"] as const).map((group) => [group, MOCK_REMINDERS.filter((reminder) => reminder.group === group)] as const);
  const done = MOCK_REMINDERS.filter((reminder) => reminder.group === "Done");

  const row = (reminder: MockReminder) => (
    <Collapse key={reminder.id} open={!cleared.has(reminder.id)}>
      <SwipeRow
        gone={cleared.has(reminder.id)}
        right={{ label: "✓ Done", tone: "positive", commit: true }}
        left={{ label: "Snooze", tone: "warning" }}
        onSwipe={(side) => (side === "right" ? act(reminder, "Marked done") : setSnoozing(reminder))}
      >
        <MockRow
          leading={<ReminderTile reminder={reminder} />}
          title={reminder.title}
          meta={[reminder.when, reminder.repeat].filter(Boolean).join(" · ")}
          metaTone={reminder.overdue ? "error" : undefined}
          trailing={
            <RowActions
              label={reminder.title}
              actions={[
                { label: "Done", icon: Check, onSelect: () => act(reminder, "Marked done") },
                { label: "Snooze", icon: AlarmClock, onSelect: () => setSnoozing(reminder) },
                { label: "Edit", icon: Pencil, onSelect: () => showToast({ message: "Edit opens the reminder form (U10)" }) },
                { label: "Delete", icon: Trash2, onSelect: () => act(reminder, "Reminder deleted"), tone: "danger" },
              ]}
            />
          }
        />
      </SwipeRow>
    </Collapse>
  );

  return (
    <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 1fr) 20rem" }} gap={PAGE_SPACING.columnGap} alignItems="start">
      <Stack gap="3" minW="0">
        <Card>
          <Card.Body>
            <Stack gap="1">
              {groups.map(([group, reminders]) => (
                <Box key={group}>
                  <GroupLabel>{group}</GroupLabel>
                  <Rows>{reminders.map(row)}</Rows>
                </Box>
              ))}
              <Disclosure label={`Done · ${done.length}`}>
                <Rows>{done.map(row)}</Rows>
              </Disclosure>
            </Stack>
          </Card.Body>
        </Card>
        <Text textStyle="caption" textAlign="center" display={{ md: "none" }}>
          Swipe right for Done, left to snooze.
        </Text>
      </Stack>
      <Box display={{ base: "none", lg: "block" }}>
        <Card>
          <Card.Header title="This week" description="From the family calendar" />
          <Card.Body>
            <Rows>
              {MOCK_EVENTS.map((event) => (
                <MockRow
                  key={event.id}
                  title={event.title}
                  meta={event.when}
                  trailing={
                    <Flex>
                      {event.who.map((id) => (
                        <Avatar key={id} name={memberById(id).name} color={`member.${memberById(id).slot}`} size="xs" />
                      ))}
                    </Flex>
                  }
                />
              ))}
            </Rows>
          </Card.Body>
        </Card>
      </Box>
      <AppDialog open={snoozing !== null} onOpenChange={(open) => !open && setSnoozing(null)} title={`Snooze “${snoozing?.title ?? ""}”`} size="sm">
        <Stack gap="2">
          {MOCK_SNOOZE_CHOICES.map((choice) => (
            <Button
              key={choice}
              variant="outline"
              size="md"
              justifyContent="flex-start"
              onClick={() => {
                if (snoozing) act(snoozing, `Snoozed ${choice.toLowerCase()}`);
                setSnoozing(null);
              }}
            >
              {choice}
            </Button>
          ))}
        </Stack>
      </AppDialog>
    </Grid>
  );
}

const columnLabel = (column: MockTodoColumn) => MOCK_TODO_COLUMNS.find((item) => item.value === column)?.label ?? column;

function TodosSection() {
  const { showToast } = useMockState();
  const [todos, setTodos] = useState(MOCK_TODOS);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [deleted, setDeleted] = useIdSet();
  const [column, setColumn] = useState<MockTodoColumn>("todo");
  const live = todos.filter((todo) => !deleted.has(todo.id));
  const count = (value: MockTodoColumn) => live.filter((todo) => todo.column === value).length;
  const remove = (todo: MockTodo) => {
    setDeleted(todo.id, true);
    showToast({ message: "To-do deleted", action: "Undo", onAction: () => setDeleted(todo.id, false) });
  };
  const add = (value: MockTodoColumn, title: string) => {
    const id = `new-${todos.length}`;
    setTodos((list) => [{ id, title, column: value, assignee: "ana" }, ...list]);
    setFresh((ids) => new Set(ids).add(id));
  };
  const move = (todo: MockTodo, to: MockTodoColumn) => {
    setTodos((list) => list.map((item) => (item.id === todo.id ? { ...item, column: to } : item)));
    showToast({ message: `Moved to ${columnLabel(to)}` });
  };

  return (
    <Stack gap="3">
      <ChipRow label="Filters">
        <ChipMenu label="Showing: Everyone" items={[{ value: "all", label: "Everyone" }, { value: "me", label: "Me" }, { value: "mihai", label: "Mihai" }]} />
        <ToggleChip pressed={false}>Due today</ToggleChip>
        <ToggleChip pressed={false}>Overdue · 1</ToggleChip>
      </ChipRow>
      <Box display={{ md: "none" }}>
        <SegmentedControl
          aria-label="Column"
          fullWidth
          value={column}
          onValueChange={setColumn}
          items={MOCK_TODO_COLUMNS.map((item) => ({ value: item.value, label: `${item.label} · ${count(item.value)}` }))}
        />
      </Box>
      <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" }} gap="4" alignItems="start">
        {MOCK_TODO_COLUMNS.map((item) => (
          <Stack key={item.value} gap="2" display={{ base: item.value === column ? "flex" : "none", md: "flex" }} bg={{ md: "bg.muted" }} borderRadius="card" p={{ md: "3" }}>
            <Text textStyle="sectionTitle" display={{ base: "none", md: "block" }} px="1">
              {item.label} · {count(item.value)}
            </Text>
            <AddCard onAdd={(title) => add(item.value, title)} />
            {todos
              .filter((todo) => todo.column === item.value)
              .map((todo) => (
                <Collapse key={todo.id} open={!deleted.has(todo.id)} entering={fresh.has(todo.id)}>
                  <SwipeRow gone={deleted.has(todo.id)} left={{ label: "Delete", tone: "negative", commit: true }} onSwipe={() => remove(todo)}>
                    <TodoCard
                      todo={todo}
                      actions={
                        <RowActions
                          label={todo.title}
                          actions={[
                            ...MOCK_TODO_COLUMNS.filter((target) => target.value !== todo.column).map((target) => ({
                              label: `Move to ${target.label}`,
                              icon: ArrowRightLeft,
                              onSelect: () => move(todo, target.value),
                            })),
                            { label: "Delete", icon: Trash2, onSelect: () => remove(todo), tone: "danger" as const },
                          ]}
                        />
                      }
                    />
                  </SwipeRow>
                </Collapse>
              ))}
          </Stack>
        ))}
      </Grid>
      <Text textStyle="caption" textAlign="center" display={{ md: "none" }}>
        Swipe a card left to delete it; long-press to drag it to another column.
      </Text>
    </Stack>
  );
}

/** "Add a card" at the top of each column: one tap opens a focused field, Enter adds and keeps it open. */
function AddCard({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open) {
    return (
      <Button variant="ghost" size="sm" justifyContent="flex-start" color="fg.muted" onClick={() => setOpen(true)}>
        <Plus size={ICON.sm} aria-hidden="true" /> Add a card
      </Button>
    );
  }
  return (
    <Box
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) onAdd(title.trim());
        setTitle("");
      }}
    >
      <Input
        autoFocus
        size="md"
        aria-label="New card"
        placeholder="What needs doing? Enter adds it"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => !title && setOpen(false)}
        enterKeyHint="done"
      />
    </Box>
  );
}

function TodoCard({ todo, actions }: { todo: MockTodo; actions: React.ReactNode }) {
  return (
    <Flex
      align="flex-start"
      gap="2"
      p="3"
      bg="bg.surface"
      borderRadius="control"
      boxShadow="xs"
      css={revealRowActions}
    >
      <Stack gap="1.5" flex="1" minW="0">
        <Text textStyle="body" fontWeight="medium">
          {todo.title}
        </Text>
        <Flex gap="2" align="center" wrap="wrap" textStyle="bodySm" color="fg.muted">
          {todo.due ? (
            <Text as="span" color={todo.overdue ? "fg.error" : undefined} fontWeight={todo.overdue ? "medium" : undefined}>
              {todo.due}
            </Text>
          ) : null}
          {todo.assignee ? <MemberDot id={todo.assignee} /> : <Text as="span">Anyone</Text>}
        </Flex>
      </Stack>
      {actions}
    </Flex>
  );
}

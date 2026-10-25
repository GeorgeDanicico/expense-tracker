"use client";

import { Badge, Box, Button, chakra, Flex, Link as ChakraLink, Menu, Portal, Text } from "@chakra-ui/react";
import { AlarmClock, BellOff, BellRing, Check, CircleAlert, CircleCheck, Pencil, Receipt, Repeat } from "lucide-react";
import NextLink from "next/link";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { formatDay, formatDueAt, formatInstant, overdueText, repeatLabel, snoozedText } from "@/lib/reminders/format";
import type { DoneEntry, ListedReminder } from "@/lib/reminders/list";

/** Where "Expense logged" leads: the expenses page on the occurrence's month. */
export function loggedExpenseHref(occurrenceOn: string) {
  return `/expenses?month=${occurrenceOn.slice(0, 7)}`;
}

/** The Done row's "Expense logged" marker, linking to the month the expense is in. */
function ExpenseLogged({ occurrenceOn }: { occurrenceOn: string }) {
  return (
    <ChakraLink asChild color="fg.accent" fontWeight="medium" display="inline-flex" alignItems="center" gap="1">
      <NextLink href={loggedExpenseHref(occurrenceOn)}>
        <Receipt size={12} strokeWidth={ICON_STROKE} aria-hidden="true" /> Expense logged
      </NextLink>
    </ChakraLink>
  );
}

export type SnoozeChoice = "hour" | "tomorrow" | "until";

const LEADING: Record<ListedReminder["state"], { icon: typeof BellRing; color: string; bg: string; label: string }> = {
  upcoming: { icon: BellRing, color: "fg.muted", bg: "bg.subtle", label: "Upcoming" },
  due: { icon: BellRing, color: "brand.fg", bg: "brand.muted", label: "Due today" },
  overdue: { icon: CircleAlert, color: "fg.error", bg: "bg.error", label: "Overdue" },
  snoozed: { icon: AlarmClock, color: "fg.muted", bg: "bg.subtle", label: "Snoozed" },
  done: { icon: CircleCheck, color: "fg.success", bg: "bg.success", label: "Done" },
};

function Leading({ state }: { state: ListedReminder["state"] }) {
  const { icon: Icon, color, bg } = LEADING[state];
  return (
    <Flex flexShrink="0" boxSize="8" align="center" justify="center" borderRadius="full" bg={bg} color={color} aria-hidden="true">
      <Icon size={ICON.sm} strokeWidth={ICON_STROKE} />
    </Flex>
  );
}

/** The title as a button that opens the reminder's dialog. */
function TitleButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      textAlign="start"
      textStyle="bodySm"
      fontWeight="medium"
      color="fg"
      minW="0"
      wordBreak="break-word"
      lineClamp={2}
      cursor="pointer"
      borderRadius="l1"
      _hover={{ textDecoration: "underline" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "brand.focusRing", outlineOffset: "2px" }}
    >
      {title}
    </chakra.button>
  );
}

function Meta({ children, color = "fg.muted" }: { children: ReactNode; color?: string }) {
  return (
    <Flex align="center" gap="1" textStyle="caption" color={color} minW="0" wrap="wrap">
      {children}
    </Flex>
  );
}

/**
 * One list row. `reminderId` lets the page find it (`/reminders?focus=<id>`); `focused` rings it
 * briefly when a notification opened the page on it.
 */
function RowFrame({
  reminderId,
  highlight = false,
  focused = false,
  children,
}: {
  reminderId: string;
  highlight?: boolean;
  focused?: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      as="li"
      data-reminder-id={reminderId}
      data-focused={focused ? "" : undefined}
      listStyleType="none"
      px={{ base: "3", md: "4" }}
      py="3"
      borderBottomWidth="1px"
      borderColor="border"
      bg={focused ? "brand.muted" : highlight ? "brand.subtle" : undefined}
      boxShadow={focused ? "inset 0 0 0 2px {colors.brand.focusRing}" : undefined}
      transition="background-color 0.6s ease, box-shadow 0.6s ease"
      scrollMarginBlock="6rem"
      _last={{ borderBottomWidth: "0" }}
    >
      <Flex align="center" gap="3" wrap="wrap" rowGap="2">
        {children}
      </Flex>
    </Box>
  );
}

/** The row's actions: their own line under the text on a phone, at the end of the row from `md`. */
function Actions({ children }: { children: ReactNode }) {
  return (
    <Flex
      data-row-actions=""
      align="center"
      gap={{ base: "2", md: "1" }}
      flexBasis={{ base: "100%", md: "auto" }}
      ps={{ base: "11", md: "0" }}
      ms={{ base: "0", md: "auto" }}
      flexShrink="0"
    >
      {children}
    </Flex>
  );
}

/** Taller touch targets on a phone, the compact size from `md`. */
const ACTION_SIZE = { base: "sm", md: "xs" } as const;

/** "Snooze" with its three choices: an hour, until tomorrow 09:00, or a chosen time. */
function SnoozeMenu({ title, disabled, onChoose }: { title: string; disabled: boolean; onChoose: (choice: SnoozeChoice) => void }) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }} onSelect={({ value }) => onChoose(value as SnoozeChoice)}>
      <Menu.Trigger asChild>
        <Button size={ACTION_SIZE} variant="ghost" disabled={disabled} aria-label={`Snooze ${title}`}>
          <AlarmClock size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Snooze
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="48">
            <Menu.ItemGroup>
              <Menu.ItemGroupLabel>Snooze</Menu.ItemGroupLabel>
              <Menu.Item value="hour">For an hour</Menu.Item>
              <Menu.Item value="tomorrow">Until tomorrow, 09:00</Menu.Item>
              <Menu.Item value="until">Choose a time…</Menu.Item>
            </Menu.ItemGroup>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

/**
 * One open reminder: title (opens the dialog), next due date and time, how it repeats, a muted
 * icon, how late it is or until when it's snoozed, and Mark done / Snooze / Edit. A reminder due
 * today is highlighted. On a phone (below 768 px) the actions sit on their own line under the
 * text, lined up with it, with taller touch targets; from 768 px they share the row.
 */
export function ReminderRow({
  reminder,
  now,
  busy = false,
  focused = false,
  onComplete,
  onSnooze,
  onEdit,
}: {
  reminder: ListedReminder;
  now: Date;
  /** A write for this reminder is in flight: its actions wait. */
  busy?: boolean;
  /** A notification opened the page on this reminder: highlight it for a moment. */
  focused?: boolean;
  onComplete: (reminder: ListedReminder) => void;
  onSnooze: (reminder: ListedReminder, choice: SnoozeChoice) => void;
  onEdit: (reminder: ListedReminder) => void;
}) {
  const { state } = reminder;
  const due = formatDueAt(reminder, now);
  const snoozed = state === "snoozed" ? snoozedText(reminder, now) : null;

  return (
    <RowFrame reminderId={reminder.id} highlight={state === "due"} focused={focused}>
      <Leading state={state} />
      <Flex direction="column" gap="0.5" flex="1 1 14rem" minW="0">
        <Flex align="center" gap="2" minW="0">
          <TitleButton title={reminder.title} onClick={() => onEdit(reminder)} />
          {state === "due" ? <Badge size="sm" variant="solid" colorPalette="brand" flexShrink="0">Today</Badge> : null}
          {reminder.notificationsMuted ? (
            <Box as="span" color="fg.subtle" flexShrink="0" title="Notifications muted">
              <BellOff size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <span className="sr-only">Notifications muted</span>
            </Box>
          ) : null}
        </Flex>
        <Meta>
          <Text as="span"><span className="sr-only">Due </span>{due}</Text>
          <Text as="span" aria-hidden="true">·</Text>
          <Flex as="span" align="center" gap="1">
            <Repeat size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
            {repeatLabel(reminder.repeatUnit, reminder.repeatInterval)}
          </Flex>
        </Meta>
        {state === "overdue" && reminder.nextDueAt ? (
          <Meta color="fg.error">
            <Text as="span" fontWeight="medium">{overdueText(reminder.nextDueAt, now)}</Text>
          </Meta>
        ) : null}
        {snoozed ? (
          <Meta>
            <AlarmClock size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <Text as="span">{snoozed}</Text>
          </Meta>
        ) : null}
      </Flex>
      <Actions>
        <Button size={ACTION_SIZE} variant="outline" disabled={busy} onClick={() => onComplete(reminder)} aria-label={`Mark ${reminder.title} done`}>
          <Check size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Mark done
        </Button>
        <SnoozeMenu title={reminder.title} disabled={busy} onChoose={(choice) => onSnooze(reminder, choice)} />
        <Box ms={{ base: "auto", md: "0" }}>
          <IconButton aria-label={`Edit ${reminder.title}`} size="xs" tooltip onClick={() => onEdit(reminder)}>
            <Pencil size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </IconButton>
        </Box>
      </Actions>
    </RowFrame>
  );
}

/**
 * One occurrence marked done: the reminder's title, when it was done, the occurrence's date, and
 * "Expense logged" when an expense was logged with it (and not deleted since).
 */
export function DoneRow({
  entry,
  now,
  focused = false,
  onEdit,
}: {
  entry: DoneEntry;
  now: Date;
  /** A notification opened the page on this reminder: highlight it for a moment. */
  focused?: boolean;
  onEdit: (reminder: DoneEntry["reminder"]) => void;
}) {
  const { completion, reminder } = entry;
  return (
    <RowFrame reminderId={reminder.id} focused={focused}>
      <Leading state="done" />
      <Flex direction="column" gap="0.5" flex="1 1 14rem" minW="0">
        <TitleButton title={reminder.title} onClick={() => onEdit(reminder)} />
        <Meta>
          <Text as="span">Done {formatInstant(completion.doneAt, reminder.timezone, now)}</Text>
          <Text as="span" aria-hidden="true">·</Text>
          <Text as="span">for {formatDay(completion.occurrenceOn, now)}</Text>
          {completion.expenseId ? (
            <>
              <Text as="span" aria-hidden="true">·</Text>
              <ExpenseLogged occurrenceOn={completion.occurrenceOn} />
            </>
          ) : null}
        </Meta>
      </Flex>
      <Actions>
        <Text textStyle="caption" color="fg.muted">
          {reminder.nextDueOn === null ? "Finished" : `Next ${formatDay(reminder.nextDueOn, now)}`}
        </Text>
      </Actions>
    </RowFrame>
  );
}

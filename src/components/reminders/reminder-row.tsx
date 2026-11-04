"use client";

import { Box, chakra, Flex, Menu, Portal, Text } from "@chakra-ui/react";
import { AlarmClock, BellOff, BellRing, Check, CircleAlert, CircleCheck, Receipt } from "lucide-react";
import NextLink from "next/link";
import { useState, type ReactNode } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconTile } from "@/components/ui/icon-tile";
import { ListRow } from "@/components/ui/list-row";
import { SwipeRow } from "@/components/ui/row-actions";
import { transition } from "@/components/ui/theme/motion";
import { formatDay, formatDueAt, formatInstant, overdueText, repeatLabel, snoozedText } from "@/lib/reminders/format";
import type { DoneEntry, ListedReminder } from "@/lib/reminders/list";

/** Where "Expense logged" leads: the expenses page on the occurrence's month. */
export function loggedExpenseHref(occurrenceOn: string) {
  return `/expenses?month=${occurrenceOn.slice(0, 7)}`;
}

/** The Done row's "Expense logged" marker, linking to the month the expense is in. */
function ExpenseLogged({ occurrenceOn }: { occurrenceOn: string }) {
  return (
    <chakra.span color="fg.accent" fontWeight="medium">
      <NextLink href={loggedExpenseHref(occurrenceOn)}>
        <Receipt size={12} strokeWidth={ICON_STROKE} aria-hidden="true" style={{ display: "inline", verticalAlign: "-1px" }} /> Expense logged
      </NextLink>
    </chakra.span>
  );
}

export type SnoozeChoice = "hour" | "tomorrow" | "until";

const TILE: Record<ListedReminder["state"], { icon: typeof BellRing; color: string; bg: string }> = {
  upcoming: { icon: BellRing, color: "fg.muted", bg: "bg.subtle" },
  due: { icon: BellRing, color: "brand.fg", bg: "brand.muted" },
  overdue: { icon: CircleAlert, color: "fg.error", bg: "bg.error" },
  snoozed: { icon: AlarmClock, color: "fg.muted", bg: "bg.subtle" },
  done: { icon: CircleCheck, color: "fg.success", bg: "bg.success" },
};

function Tile({ state }: { state: ListedReminder["state"] }) {
  return <IconTile {...TILE[state]} />;
}

/** The title as a button that opens the reminder's dialog. */
function TitleButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="block"
      maxW="full"
      textAlign="start"
      color="fg"
      cursor="pointer"
      truncate
      borderRadius="l1"
      _hover={{ textDecoration: "underline" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "brand.focusRing", outlineOffset: "2px" }}
    >
      {title}
    </chakra.button>
  );
}

/**
 * One list item. `reminderId` lets the page find it (`/reminders?focus=<id>`); `focused` rings it
 * briefly when a notification opened the page on it.
 */
function Item({ reminderId, focused = false, children }: { reminderId: string; focused?: boolean; children: ReactNode }) {
  return (
    <Box
      as="li"
      data-reminder-id={reminderId}
      data-focused={focused ? "" : undefined}
      listStyleType="none"
      borderRadius="control"
      bg={focused ? "brand.muted" : undefined}
      boxShadow={focused ? "inset 0 0 0 2px {colors.brand.focusRing}" : undefined}
      transition={transition("background-color, box-shadow", "slow")}
      scrollMarginBlock="6rem"
    >
      {children}
    </Box>
  );
}

/** Snooze, an icon button with its three choices: an hour, until tomorrow 09:00, or a chosen time. */
export function SnoozeMenu({
  title,
  disabled,
  onChoose,
  open,
  onOpenChange,
}: {
  title: string;
  disabled: boolean;
  onChoose: (choice: SnoozeChoice) => void;
  /** Controlled by a swipe left (`ReminderSwipe`), which opens the choices. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Menu.Root
      positioning={{ placement: "bottom-end" }}
      open={open}
      onOpenChange={onOpenChange ? (details) => onOpenChange(details.open) : undefined}
      onSelect={({ value }) => onChoose(value as SnoozeChoice)}
    >
      <Menu.Trigger asChild>
        <IconButton aria-label={`Snooze ${title}`} disabled={disabled}>
          <AlarmClock size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </IconButton>
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
 * A reminder's swipes on a phone: right for Done, left for Snooze's three choices (the row's Snooze
 * menu opens). Render `snoozeMenu` in the row; the row's own Done and Snooze buttons stay, so the
 * swipe is never the only way. Nothing swipes while the reminder's write is in flight.
 */
export function ReminderSwipe({
  reminder,
  busy,
  onComplete,
  onSnooze,
  children,
}: {
  reminder: ListedReminder;
  busy: boolean;
  onComplete: (reminder: ListedReminder) => void;
  onSnooze: (reminder: ListedReminder, choice: SnoozeChoice) => void;
  children: (snoozeMenu: ReactNode) => ReactNode;
}) {
  const [snoozing, setSnoozing] = useState(false);
  const snoozeMenu = (
    <SnoozeMenu
      title={reminder.title}
      disabled={busy}
      open={snoozing}
      onOpenChange={setSnoozing}
      onChoose={(choice) => onSnooze(reminder, choice)}
    />
  );
  return (
    <SwipeRow
      right={busy ? undefined : { label: "Done", icon: Check, tone: "success", commit: true, onSwipe: () => onComplete(reminder) }}
      left={busy ? undefined : { label: "Snooze", icon: AlarmClock, tone: "warning", onSwipe: () => setSnoozing(true) }}
    >
      {children(snoozeMenu)}
    </SwipeRow>
  );
}

/**
 * One open reminder: a tile for where it stands, the title (opens the dialog), when it's due, how it
 * repeats, how late it is or until when it's snoozed, and Snooze and Done on the row (and as swipes
 * on a phone).
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
  const snoozed = state === "snoozed" ? snoozedText(reminder, now) : null;
  return (
    <Item reminderId={reminder.id} focused={focused}>
      <ReminderSwipe reminder={reminder} busy={busy} onComplete={onComplete} onSnooze={onSnooze}>
        {(snoozeMenu) => (
          <ListRow
            as="div"
            leading={<Tile state={state} />}
            title={(
              <Flex align="center" gap="1.5" minW="0">
                <TitleButton title={reminder.title} onClick={() => onEdit(reminder)} />
                {reminder.notificationsMuted ? (
                  <Box as="span" color="fg.subtle" flexShrink="0" title="Notifications muted">
                    <BellOff size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
                    <span className="sr-only">Notifications muted</span>
                  </Box>
                ) : null}
              </Flex>
            )}
            meta={(
              <>
                <span className="sr-only">Due </span>
                {formatDueAt(reminder, now)}
                {reminder.repeatUnit === "none" ? null : ` · ${repeatLabel(reminder.repeatUnit, reminder.repeatInterval)}`}
                {state === "overdue" && reminder.nextDueAt ? (
                  <Text as="span" color="fg.error" fontWeight="medium"> · {overdueText(reminder.nextDueAt, now)}</Text>
                ) : null}
                {snoozed ? ` · ${snoozed}` : null}
              </>
            )}
            trailing={(
              <>
                {snoozeMenu}
                <IconButton aria-label={`Mark ${reminder.title} done`} disabled={busy} onClick={() => onComplete(reminder)}>
                  <Box as="span" display="inline-flex" color="fg.success">
                    <Check size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  </Box>
                </IconButton>
              </>
            )}
          />
        )}
      </ReminderSwipe>
    </Item>
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
    <Item reminderId={reminder.id} focused={focused}>
      <ListRow
        as="div"
        leading={<Tile state="done" />}
        title={<TitleButton title={reminder.title} onClick={() => onEdit(reminder)} />}
        meta={(
          <>
            Done {formatInstant(completion.doneAt, reminder.timezone, now)} · for {formatDay(completion.occurrenceOn, now)}
            {completion.expenseId ? <> · <ExpenseLogged occurrenceOn={completion.occurrenceOn} /></> : null}
          </>
        )}
        trailing={(
          <Text textStyle="caption">
            {reminder.nextDueOn === null ? "Finished" : `Next ${formatDay(reminder.nextDueOn, now)}`}
          </Text>
        )}
      />
    </Item>
  );
}

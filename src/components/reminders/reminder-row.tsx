"use client";

import { Badge, Box, Button, chakra, Flex, Menu, Portal, Text } from "@chakra-ui/react";
import { AlarmClock, BellOff, BellRing, Check, CircleAlert, CircleCheck, Pencil, Repeat } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { formatDay, formatDueAt, formatInstant, overdueText, repeatLabel, snoozedText } from "@/lib/reminders/format";
import type { DoneEntry, ListedReminder } from "@/lib/reminders/list";

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

function RowFrame({ highlight = false, children }: { highlight?: boolean; children: ReactNode }) {
  return (
    <Box
      as="li"
      listStyleType="none"
      px={{ base: "3", md: "4" }}
      py="3"
      borderBottomWidth="1px"
      borderColor="border"
      bg={highlight ? "brand.subtle" : undefined}
      _last={{ borderBottomWidth: "0" }}
    >
      <Flex align="center" gap="3" wrap="wrap" rowGap="2">
        {children}
      </Flex>
    </Box>
  );
}

/** "Snooze" with its three choices: an hour, until tomorrow 09:00, or a chosen time. */
function SnoozeMenu({ title, disabled, onChoose }: { title: string; disabled: boolean; onChoose: (choice: SnoozeChoice) => void }) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }} onSelect={({ value }) => onChoose(value as SnoozeChoice)}>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" disabled={disabled} aria-label={`Snooze ${title}`}>
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
 * today is highlighted. The actions wrap under the text on a narrow screen.
 */
export function ReminderRow({
  reminder,
  now,
  busy = false,
  onComplete,
  onSnooze,
  onEdit,
}: {
  reminder: ListedReminder;
  now: Date;
  /** A write for this reminder is in flight: its actions wait. */
  busy?: boolean;
  onComplete: (reminder: ListedReminder) => void;
  onSnooze: (reminder: ListedReminder, choice: SnoozeChoice) => void;
  onEdit: (reminder: ListedReminder) => void;
}) {
  const { state } = reminder;
  const due = formatDueAt(reminder, now);
  const snoozed = state === "snoozed" ? snoozedText(reminder, now) : null;

  return (
    <RowFrame highlight={state === "due"}>
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
      <Flex align="center" gap="1" ms="auto" flexShrink="0">
        <Button size="xs" variant="outline" disabled={busy} onClick={() => onComplete(reminder)} aria-label={`Mark ${reminder.title} done`}>
          <Check size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Mark done
        </Button>
        <SnoozeMenu title={reminder.title} disabled={busy} onChoose={(choice) => onSnooze(reminder, choice)} />
        <IconButton aria-label={`Edit ${reminder.title}`} size="xs" tooltip onClick={() => onEdit(reminder)}>
          <Pencil size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </IconButton>
      </Flex>
    </RowFrame>
  );
}

/** One occurrence marked done: the reminder's title, when it was done, and the occurrence's date. */
export function DoneRow({ entry, now, onEdit }: { entry: DoneEntry; now: Date; onEdit: (reminder: DoneEntry["reminder"]) => void }) {
  const { completion, reminder } = entry;
  return (
    <RowFrame>
      <Leading state="done" />
      <Flex direction="column" gap="0.5" flex="1 1 14rem" minW="0">
        <TitleButton title={reminder.title} onClick={() => onEdit(reminder)} />
        <Meta>
          <Text as="span">Done {formatInstant(completion.doneAt, reminder.timezone, now)}</Text>
          <Text as="span" aria-hidden="true">·</Text>
          <Text as="span">for {formatDay(completion.occurrenceOn, now)}</Text>
        </Meta>
      </Flex>
      <Flex align="center" gap="1" ms="auto" flexShrink="0">
        <Text textStyle="caption" color="fg.muted">
          {reminder.nextDueOn === null ? "Finished" : `Next ${formatDay(reminder.nextDueOn, now)}`}
        </Text>
      </Flex>
    </RowFrame>
  );
}

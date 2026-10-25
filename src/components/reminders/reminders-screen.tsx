"use client";

import { Badge, Box, Button, Stack, Tabs, Text } from "@chakra-ui/react";
import { BellRing, CircleCheck, PartyPopper, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ReminderDialog } from "@/components/reminders/reminder-dialog";
import { DoneRow, ReminderRow, type SnoozeChoice } from "@/components/reminders/reminder-row";
import { SnoozeDialog } from "@/components/reminders/snooze-dialog";
import { useNow, useReminders } from "@/components/reminders/use-reminders";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { doneEntries, groupReminders, tabOf, type ListedReminder, type ReminderTab } from "@/lib/reminders/list";
import { DONE_WINDOW_DAYS_LABEL } from "@/lib/reminders/format";

function List({ children }: { children: ReactNode }) {
  return (
    <Card>
      <Box as="ul" m="0" p="0">
        {children}
      </Box>
    </Card>
  );
}

function Empty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <Card>
      <Card.Body>
        <EmptyState size="sm" titleAs="h2" icon={icon} title={title} description={description} action={action} />
      </Card.Body>
    </Card>
  );
}

/** How long a reminder opened from a notification stays highlighted. */
export const FOCUS_HIGHLIGHT_MS = 2500;

/** Scrolls the reminder's first row into view, at once when the user prefers reduced motion. */
function scrollToReminder(id: string) {
  const row = [...document.querySelectorAll<HTMLElement>("[data-reminder-id]")].find((element) => element.dataset.reminderId === id);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  row?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

/**
 * The reminders page: Upcoming (due today first and highlighted, then upcoming and snoozed ones),
 * Overdue (with its count) and Done (the occurrences marked done in the last 30 days), the add
 * and edit dialog, and Snooze until…. Only the caller's own reminders; nobody else sees them.
 *
 * `focusId` (from `/reminders?focus=<id>`, where a notification leads) opens the tab that lists
 * that reminder once the list has loaded, scrolls to it and highlights it for a moment.
 */
export function RemindersScreen({ focusId = null }: { focusId?: string | null }) {
  const now = useNow();
  const reminders = useReminders(now);
  const [tab, setTab] = useState<ReminderTab>("upcoming");
  // The focus id already acted on, so a refetch or a tab change by hand doesn't jump back.
  const [handledFocus, setHandledFocus] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const groups = useMemo(() => groupReminders(reminders.reminders ?? []), [reminders.reminders]);
  const done = useMemo(
    () => doneEntries(reminders.completions ?? [], reminders.reminders ?? []),
    [reminders.completions, reminders.reminders],
  );

  if (focusId && focusId !== handledFocus && reminders.reminders) {
    // Adjusting state while rendering, once per focus id, so the right tab renders straight away.
    setHandledFocus(focusId);
    const focusTab = tabOf(focusId, groups, done);
    if (focusTab) {
      setTab(focusTab);
      setHighlighted(focusId);
    }
  }

  useEffect(() => {
    if (!highlighted) return;
    scrollToReminder(highlighted);
    const timer = setTimeout(() => setHighlighted(null), FOCUS_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

  const find = (id: string | null) => (id ? reminders.reminders?.find((reminder) => reminder.id === id) : undefined);
  const editing = find(editingId);
  const snoozing = find(snoozingId);

  /** Runs a mark done or snooze, keeping that row's actions disabled until it settles. */
  const track = useCallback(async (id: string, write: () => Promise<boolean>) => {
    setBusy((current) => new Set(current).add(id));
    try {
      await write();
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const complete = (reminder: ListedReminder) => void track(reminder.id, () => reminders.complete(reminder.id));
  const snooze = (reminder: ListedReminder, choice: SnoozeChoice) => {
    if (choice === "until") setSnoozingId(reminder.id);
    else void track(reminder.id, () => reminders.snooze(reminder.id, { kind: choice }));
  };
  const edit = (reminder: ListedReminder) => setEditingId(reminder.id);

  const addButton = (
    <Button size="sm" variant="solid" colorPalette="brand" onClick={() => setAdding(true)}>
      <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add reminder
    </Button>
  );
  const header = <PageHeader title="Reminders" description="Only you can see your reminders." actions={addButton} />;

  if (reminders.error && !reminders.reminders) {
    return (
      <Stack gap={{ base: "4", md: "5" }}>
        {header}
        <DataError message="Your reminders could not be loaded." retry={reminders.refresh} />
      </Stack>
    );
  }
  if (!reminders.reminders) return <DataLoading label="Loading your reminders…" />;

  const rowProps = { now, onComplete: complete, onSnooze: snooze, onEdit: edit };
  const overdueCount = groups.overdue.length;

  return (
    <Stack gap={{ base: "4", md: "5" }} maxW="4xl">
      {header}
      {reminders.actionError ? (
        <InlineAlert
          status="warning"
          action={(
            <IconButton aria-label="Dismiss" size="xs" onClick={reminders.dismissActionError}>
              <X size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </IconButton>
          )}
        >
          {reminders.actionError}
        </InlineAlert>
      ) : null}
      <Tabs.Root value={tab} onValueChange={({ value }) => setTab(value as ReminderTab)} lazyMount>
        <Tabs.List aria-label="Reminders" mb="4">
          <Tabs.Trigger value="upcoming">Upcoming</Tabs.Trigger>
          <Tabs.Trigger value="overdue">
            Overdue
            <Badge
              size="sm"
              variant={overdueCount > 0 ? "solid" : "subtle"}
              colorPalette={overdueCount > 0 ? "danger" : "neutral"}
              aria-label={`${overdueCount} overdue`}
            >
              {overdueCount}
            </Badge>
          </Tabs.Trigger>
          <Tabs.Trigger value="done">Done</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="upcoming" pt="0">
          {groups.upcoming.length > 0 ? (
            <List>
              {groups.upcoming.map((reminder) => (
                <ReminderRow key={reminder.id} reminder={reminder} busy={busy.has(reminder.id)} focused={reminder.id === highlighted} {...rowProps} />
              ))}
            </List>
          ) : (
            <Empty
              icon={<BellRing size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
              title={reminders.reminders.length === 0 ? "No reminders yet" : "Nothing coming up"}
              description={reminders.reminders.length === 0
                ? "Add one for the rent, a renewal or anything that repeats, and pick when it notifies you."
                : overdueCount > 0 ? "Everything open is overdue; see the Overdue tab." : "Every reminder is done."}
              action={addButton}
            />
          )}
        </Tabs.Content>
        <Tabs.Content value="overdue" pt="0">
          {overdueCount > 0 ? (
            <List>
              {groups.overdue.map((reminder) => (
                <ReminderRow key={reminder.id} reminder={reminder} busy={busy.has(reminder.id)} focused={reminder.id === highlighted} {...rowProps} />
              ))}
            </List>
          ) : (
            <Empty
              icon={<PartyPopper size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
              title="Nothing overdue"
              description="You're all caught up."
            />
          )}
        </Tabs.Content>
        <Tabs.Content value="done" pt="0">
          {done.length > 0 ? (
            <Stack gap="2">
              <List>
                {done.map((entry, index) => (
                  <DoneRow
                    key={entry.completion.id}
                    entry={entry}
                    now={now}
                    // Only its latest completion, the first listed, is highlighted.
                    focused={entry.reminder.id === highlighted && done.findIndex((other) => other.reminder.id === highlighted) === index}
                    onEdit={edit}
                  />
                ))}
              </List>
              <Text textStyle="caption" textAlign="center">{DONE_WINDOW_DAYS_LABEL}</Text>
            </Stack>
          ) : (
            <Empty
              icon={<CircleCheck size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
              title="Nothing done lately"
              description={`What you mark done shows here. ${DONE_WINDOW_DAYS_LABEL}`}
            />
          )}
        </Tabs.Content>
      </Tabs.Root>
      {adding ? (
        <ReminderDialog
          open
          onOpenChange={(open) => { if (!open) setAdding(false); }}
          onSave={reminders.add}
        />
      ) : null}
      {editing ? (
        <ReminderDialog
          key={editing.id}
          reminder={editing}
          open
          onOpenChange={(open) => { if (!open) setEditingId(null); }}
          onSave={(fields) => reminders.update(editing.id, fields)}
          onDelete={reminders.remove}
        />
      ) : null}
      {snoozing ? (
        <SnoozeDialog
          key={snoozing.id}
          reminder={snoozing}
          open
          onOpenChange={(open) => { if (!open) setSnoozingId(null); }}
          onSnooze={(until) => void track(snoozing.id, () => reminders.snooze(snoozing.id, { kind: "until", until }))}
        />
      ) : null}
    </Stack>
  );
}

"use client";

import { Box, Stack, Text } from "@chakra-ui/react";
import { BellRing, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DoneRow, ReminderRow } from "@/components/reminders/reminder-row";
import { preloadReminderActionDialogs, useReminderActions } from "@/components/reminders/use-reminder-actions";
import { REMINDERS_TICK_MS, useReminders } from "@/components/reminders/use-reminders";
import { useNow } from "@/hooks/use-now";
import { DataError } from "@/components/ui/data-state";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { GroupLabel } from "@/components/ui/group-label";
import { IconButton } from "@/components/ui/icon-button";
import { lazySheet } from "@/components/ui/lazy-sheet";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { RemindersSkeleton } from "@/components/ui/skeletons";
import { UndoToast } from "@/components/ui/undo-toast";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";
import { REMINDERS_API_KEY } from "@/lib/api/keys";
import { preloadOnIntent, usePreloadWhenIdle } from "@/lib/client/preload";
import { doneEntries, groupOf, planReminders, type ListedReminder } from "@/lib/reminders/list";
import { DONE_WINDOW_DAYS_LABEL } from "@/lib/reminders/format";

const editDialog = lazySheet(() => import("@/components/reminders/reminder-dialog").then((module) => module.ReminderDialog));
const ReminderDialog = editDialog.Sheet;

/** Starts loading every dialog the list can open: when the browser is idle after the page loads, or at the first touch. */
function preloadDialogs() {
  editDialog.preload();
  preloadReminderActionDialogs();
}

/** How long a reminder opened from a notification stays highlighted. */
export const FOCUS_HIGHLIGHT_MS = 2500;

/** Scrolls the reminder's first row into view, at once when the user prefers reduced motion. */
function scrollToReminder(id: string) {
  const row = [...document.querySelectorAll<HTMLElement>("[data-reminder-id]")].find((element) => element.dataset.reminderId === id);
  row?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/** How long "Marked done" stays on screen. */
const TOAST_MS = 3000;

/**
 * The reminders page: one list grouped as Today (what is overdue or due today, with Done and Snooze
 * on each row), Upcoming, and Done folded under its count (the occurrences marked done in the last
 * 30 days). Only the caller's own reminders; nobody else sees them. Adding is the shell's + button.
 *
 * `focusId` (from `/reminders?focus=<id>`, where a notification leads) scrolls to that reminder
 * once the list has loaded, opens Done when it is there, and highlights it for a moment.
 */
export function RemindersScreen({ focusId = null }: { focusId?: string | null }) {
  usePreloadWhenIdle(preloadDialogs);
  const now = useNow(REMINDERS_TICK_MS);
  const reminders = useReminders(now);
  const [toast, setToast] = useState<string | null>(null);
  const { busy, complete, snooze, dialogs } = useReminderActions(reminders, now, setToast);
  // The focus id already acted on, so a refetch doesn't jump back.
  const [handledFocus, setHandledFocus] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const plan = useMemo(() => planReminders(reminders.reminders ?? []), [reminders.reminders]);
  const done = useMemo(
    () => doneEntries(reminders.completions ?? [], reminders.reminders ?? []),
    [reminders.completions, reminders.reminders],
  );

  if (focusId && focusId !== handledFocus && reminders.reminders) {
    // Adjusting state while rendering, once per focus id, so the right group renders straight away.
    setHandledFocus(focusId);
    const group = groupOf(focusId, plan, done);
    if (group) {
      setDoneOpen(group === "done");
      setHighlighted(focusId);
    }
  }

  useEffect(() => {
    if (!highlighted) return;
    scrollToReminder(highlighted);
    const timer = setTimeout(() => setHighlighted(null), FOCUS_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const editing = editingId ? reminders.reminders?.find((reminder) => reminder.id === editingId) : undefined;
  const edit = (reminder: ListedReminder) => setEditingId(reminder.id);

  const header = <PageHeader title="Reminders" description="Only you can see your reminders." />;

  if (reminders.error && !reminders.reminders) {
    return (
      <Stack gap={{ base: "4", md: "5" }}>
        {header}
        <DataError message="Your reminders could not be loaded." retry={reminders.refresh} />
      </Stack>
    );
  }
  if (!reminders.reminders) return <RemindersSkeleton slowKey={REMINDERS_API_KEY} />;

  const openRows = (list: readonly ListedReminder[]) => list.map((reminder) => (
    <ReminderRow
      key={reminder.id}
      reminder={reminder}
      now={now}
      busy={busy.has(reminder.id)}
      focused={reminder.id === highlighted}
      onComplete={complete}
      onSnooze={snooze}
      onEdit={edit}
    />
  ));
  const group = (label: string, rows: ReactNode) => (
    <Box>
      <GroupLabel px="2">{label}</GroupLabel>
      <Stack as="ul" gap="0.5" m="0" p="0">{rows}</Stack>
    </Box>
  );
  const nothingOpen = plan.today.length === 0 && plan.upcoming.length === 0;

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
      <Card {...preloadOnIntent(preloadDialogs)}>
        <Card.Body>
          <Stack gap="1">
            {plan.today.length > 0 ? group("Today", openRows(plan.today)) : null}
            {plan.upcoming.length > 0 ? group("Upcoming", openRows(plan.upcoming)) : null}
            {nothingOpen ? (
              <EmptyState
                size="sm"
                titleAs="h2"
                icon={<BellRing size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
                title={reminders.reminders.length === 0 ? "No reminders yet" : "Nothing to do"}
                description={reminders.reminders.length === 0
                  ? "Tap + to add one for the rent, a renewal or anything that repeats."
                  : "Everything is done."}
              />
            ) : plan.today.length === 0 ? (
              <Text textStyle="caption" px="2" py="1">Nothing due today.</Text>
            ) : null}
            {done.length > 0 ? (
              <Disclosure key={doneOpen ? "open" : "closed"} label={`Done · ${done.length}`} defaultOpen={doneOpen}>
                <Stack as="ul" gap="0.5" m="0" p="0">
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
                </Stack>
                <Text textStyle="caption" textAlign="center">{DONE_WINDOW_DAYS_LABEL}</Text>
              </Disclosure>
            ) : null}
          </Stack>
        </Card.Body>
      </Card>
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
      {dialogs}
      <UndoToast message={toast} />
    </Stack>
  );
}

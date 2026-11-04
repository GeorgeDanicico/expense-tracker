"use client";

import { Box, Button, Text } from "@chakra-ui/react";
import { BellRing, CircleAlert, PartyPopper, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SnoozeMenu } from "@/components/reminders/reminder-row";
import { useReminderActions } from "@/components/reminders/use-reminder-actions";
import { REMINDERS_TICK_MS, useReminders } from "@/components/reminders/use-reminders";
import { useNow } from "@/hooks/use-now";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { IconTile } from "@/components/ui/icon-tile";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ListRow } from "@/components/ui/list-row";
import { SectionLink } from "@/components/ui/section-link";
import { UndoToast } from "@/components/ui/undo-toast";
import { dueReminders, dueTimeLabel } from "@/lib/home/today";
import { formatDay, overdueText } from "@/lib/reminders/format";
import type { ListedReminder } from "@/lib/reminders/list";

/** How long "Marked done" stays on screen. */
const TOAST_MS = 3000;

function Meta({ reminder, now }: { reminder: ListedReminder; now: Date }) {
  if (reminder.state === "overdue" && reminder.nextDueAt) {
    return <Text as="span" color="fg.error" fontWeight="medium">Overdue · {overdueText(reminder.nextDueAt, now)}</Text>;
  }
  return <>Today · {dueTimeLabel(reminder)}</>;
}

/**
 * What's overdue and due today, with Done and Snooze on the row: Done is one tap (a reminder with an
 * expense template asks about the expense first). A write shows at once and goes back if the server
 * refuses it, with the reason above the rows (`useReminders`).
 */
export function DueReminders() {
  const now = useNow(REMINDERS_TICK_MS);
  const reminders = useReminders(now);
  const [toast, setToast] = useState<string | null>(null);
  const actions = useReminderActions(reminders, now, setToast);
  const { shown, more, next } = useMemo(() => dueReminders(reminders.reminders ?? []), [reminders.reminders]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const header = <Card.Header title="Due today" actions={<SectionLink href="/reminders">All reminders</SectionLink>} />;
  if (!reminders.reminders) {
    return (
      <Card size="sm">
        {header}
        <Card.Body>
          {reminders.error ? <DataError message="Your reminders could not be loaded." retry={reminders.refresh} /> : <DataLoading layout="section" label="Loading your reminders…" />}
        </Card.Body>
      </Card>
    );
  }
  return (
    <Card size="sm">
      {header}
      <Card.Body>
        {reminders.actionError ? (
          <Box mb="2">
            <InlineAlert status="warning" action={<IconButton aria-label="Dismiss" size="xs" onClick={reminders.dismissActionError}><X size={ICON.xs} aria-hidden="true" /></IconButton>}>
              {reminders.actionError}
            </InlineAlert>
          </Box>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState
            size="sm"
            titleAs="p"
            icon={<PartyPopper size={ICON.nav} aria-hidden="true" />}
            title="Nothing due today"
            description={next ? `Next: ${next.title}, ${next.nextDueOn ? formatDay(next.nextDueOn, now) : ""}` : "Reminders you add show up here when they're due."}
          />
        ) : (
          <Box as="ul" m="0" p="0">
            {shown.map((reminder) => (
              <ListRow
                key={reminder.id}
                leading={
                  <IconTile
                    icon={reminder.state === "overdue" ? CircleAlert : BellRing}
                    bg={reminder.state === "overdue" ? "bg.error" : "bg.info"}
                    color={reminder.state === "overdue" ? "fg.error" : "fg.info"}
                  />
                }
                title={reminder.title}
                meta={<Meta reminder={reminder} now={now} />}
                trailing={
                  <>
                    <SnoozeMenu title={reminder.title} disabled={actions.busy.has(reminder.id)} onChoose={(choice) => actions.snooze(reminder, choice)} />
                    <Button
                      size="sm"
                      variant="solid"
                      colorPalette="brand"
                      disabled={actions.busy.has(reminder.id)}
                      aria-label={`Mark ${reminder.title} done`}
                      onClick={() => actions.complete(reminder)}
                    >
                      Done
                    </Button>
                  </>
                }
              />
            ))}
          </Box>
        )}
        {more > 0 ? (
          <Text textStyle="caption" px="2" pt="1">
            +{more} more due. <SectionLink href="/reminders">See all</SectionLink>
          </Text>
        ) : null}
      </Card.Body>
      {actions.dialogs}
      <UndoToast message={toast} />
    </Card>
  );
}

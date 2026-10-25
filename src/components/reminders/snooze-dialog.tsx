"use client";

import { Input, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { ListedReminder } from "@/lib/reminders/list";
import { utcToZoned, zonedTimeToUtc } from "@/lib/time-zone";

const HOUR = 60 * 60 * 1000;

/** The form's first suggestion: two hours from `now`, on the hour, in `timeZone`. */
export function defaultSnoozeUntil(now: Date, timeZone: string) {
  const later = utcToZoned(new Date(now.getTime() + 2 * HOUR), timeZone);
  return { date: later.date, time: `${later.time.slice(0, 2)}:00` };
}

/**
 * The chosen snooze end as an ISO instant, or an error when the fields are incomplete or the time
 * isn't in the future. The date and time are read in the reminder's time zone.
 */
export function snoozeUntilInstant(date: string, time: string, timeZone: string, now: Date) {
  if (!date || !time) return { error: "Choose a date and a time." } as const;
  const until = zonedTimeToUtc(date, time, timeZone);
  if (until.getTime() <= now.getTime()) return { error: "Choose a time in the future." } as const;
  return { until: until.toISOString() } as const;
}

/** "Snooze until…": a date and a time, in the reminder's time zone. */
export function SnoozeDialog({
  reminder,
  open,
  onOpenChange,
  onSnooze,
}: {
  reminder: ListedReminder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (until: string) => void;
}) {
  const [initial] = useState(() => defaultSnoozeUntil(new Date(), reminder.timezone));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState("");
  const formId = `snooze-${reminder.id}`;

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Snooze until…"
      description={reminder.title}
      footer={<FormActions submitLabel="Snooze" form={formId} closesDialog />}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          const result = snoozeUntilInstant(date, time, reminder.timezone, new Date());
          if ("error" in result) {
            setError(result.error ?? "");
            return;
          }
          onSnooze(result.until);
          onOpenChange(false);
        }}
      >
        <Stack gap="3">
          <FormRow>
            <FormField flex="1" label="Date">
              <Input name="date" type="date" value={date} required onChange={(event) => setDate(event.target.value)} />
            </FormField>
            <FormField flex="1" label="Time">
              <Input name="time" type="time" step={60} value={time} required onChange={(event) => setTime(event.target.value)} />
            </FormField>
          </FormRow>
          <Text textStyle="caption">It leaves Overdue until then, and notifies you again at that time.</Text>
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
        </Stack>
      </form>
    </AppDialog>
  );
}

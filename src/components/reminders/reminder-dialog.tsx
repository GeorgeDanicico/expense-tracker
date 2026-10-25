"use client";

import { Button, Flex, Input, NativeSelect, Stack, Switch, Text, Textarea } from "@chakra-ui/react";
import { Check, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import type { ReminderFields } from "@/components/reminders/reminder-api";
import { AppDialog } from "@/components/ui/app-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { getBucharestToday } from "@/lib/calendar";
import { formatDueAt, repeatLabel, repeatUnitName } from "@/lib/reminders/format";
import type { ListedReminder } from "@/lib/reminders/list";
import {
  DEFAULT_LEAD_MINUTES,
  DEFAULT_TIME_OF_DAY,
  LEAD_TIME_PRESETS,
  MAX_LEAD_TIMES,
  MAX_REPEAT_INTERVAL,
  MIN_REPEAT_INTERVAL,
  type RepeatUnit,
} from "@/lib/reminders/types";

/** The form's fields as typed; the interval stays text until it's sent. */
export type ReminderDraft = {
  title: string;
  notes: string;
  startsOn: string;
  timeOfDay: string;
  repeatUnit: RepeatUnit;
  repeatInterval: string;
  leadMinutes: number[];
  notificationsMuted: boolean;
};

const REPEAT_OPTIONS: { value: RepeatUnit; label: string }[] = [
  { value: "none", label: "Doesn't repeat" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "year", label: "By year" },
];

/** The form's starting values: the reminder's, or a new one's (today at 09:00, once, at the time). */
export function draftFor(reminder: ListedReminder | undefined, today: string): ReminderDraft {
  if (!reminder) {
    return {
      title: "",
      notes: "",
      startsOn: today,
      timeOfDay: DEFAULT_TIME_OF_DAY,
      repeatUnit: "none",
      repeatInterval: String(MIN_REPEAT_INTERVAL),
      leadMinutes: [...DEFAULT_LEAD_MINUTES],
      notificationsMuted: false,
    };
  }
  return {
    title: reminder.title,
    notes: reminder.notes,
    startsOn: reminder.startsOn,
    timeOfDay: reminder.timeOfDay.slice(0, 5),
    repeatUnit: reminder.repeatUnit,
    repeatInterval: String(reminder.repeatInterval),
    leadMinutes: [...reminder.leadMinutes],
    notificationsMuted: reminder.notificationsMuted,
  };
}

/**
 * Every field of the reminder as POST and PATCH take it. PATCH replaces the whole reminder, so
 * nothing is ever left out. Text is trimmed and the lead times sorted; a one-off's interval is 1.
 * The server validates the rest (an interval outside 1–12 comes back as a field error).
 */
export function draftToFields(draft: ReminderDraft): ReminderFields {
  const interval = Number(draft.repeatInterval.trim());
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    startsOn: draft.startsOn,
    timeOfDay: draft.timeOfDay,
    repeatUnit: draft.repeatUnit,
    repeatInterval: draft.repeatUnit === "none" ? MIN_REPEAT_INTERVAL : interval,
    leadMinutes: [...draft.leadMinutes].sort((a, b) => a - b),
    notificationsMuted: draft.notificationsMuted,
  };
}

/** `selected` with `minutes` toggled; adding is refused (unchanged) once `MAX_LEAD_TIMES` are on. */
export function toggleLeadTime(selected: readonly number[], minutes: number): number[] {
  if (selected.includes(minutes)) return selected.filter((value) => value !== minutes);
  if (selected.length >= MAX_LEAD_TIMES) return [...selected];
  return [...selected, minutes].sort((a, b) => a - b);
}

function LeadTimeChips({ selected, onChange }: { selected: number[]; onChange: (next: number[]) => void }) {
  const full = selected.length >= MAX_LEAD_TIMES;
  return (
    <Flex gap="2" wrap="wrap">
      {LEAD_TIME_PRESETS.map((preset) => {
        const pressed = selected.includes(preset.minutes);
        return (
          <Button
            key={preset.minutes}
            size="xs"
            variant={pressed ? "solid" : "outline"}
            colorPalette={pressed ? "brand" : undefined}
            aria-pressed={pressed}
            disabled={!pressed && full}
            onClick={() => onChange(toggleLeadTime(selected, preset.minutes))}
          >
            {pressed ? <Check size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> : null}
            {preset.label}
          </Button>
        );
      })}
    </Flex>
  );
}

/**
 * Add a reminder, or edit one (with Delete, after a confirmation): title, notes, first date, time,
 * repeat with its interval, up to three lead times, and mute. Always sends every field.
 */
export function ReminderDialog({
  reminder,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  /** The reminder to edit; absent to add one. */
  reminder?: ListedReminder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (fields: ReminderFields) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const form = useApiForm();
  const removal = useApiForm();
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<ReminderDraft>(() => draftFor(reminder, getBucharestToday()));
  const leadLabel = useId();
  const formId = `reminder-${reminder?.id ?? "new"}`;
  const editing = reminder !== undefined;
  const next = reminder ? formatDueAt(reminder) : null;
  const interval = Number(draft.repeatInterval);

  function save() {
    void form.submit(async () => {
      await onSave(draftToFields(draft));
      onOpenChange(false);
    }, { fallback: "The reminder could not be saved." });
  }

  function remove() {
    if (!reminder || !onDelete) return;
    void removal.submit(async () => {
      await onDelete(reminder.id);
      setConfirming(false);
      onOpenChange(false);
    }, { fallback: "The reminder could not be deleted." });
  }

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={(value) => {
          if (!form.pending) onOpenChange(value);
        }}
        title={editing ? "Edit reminder" : "Add reminder"}
        description={editing
          ? (next ? `Next: ${next}. Only you can see it.` : "Done. Move the first date on to use it again.")
          : "Only you can see your reminders. Times are Bucharest time."}
        footer={(
          <FormActions
            submitLabel={editing ? "Save reminder" : "Add reminder"}
            form={formId}
            closesDialog
            pending={form.pending}
            leading={editing && onDelete ? (
              <Button variant="ghost" size={{ base: "md", sm: "sm" }} colorPalette="danger" onClick={() => setConfirming(true)} disabled={form.pending}>
                <Trash2 size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Delete
              </Button>
            ) : undefined}
          />
        )}
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Stack gap="3">
            <FormField label="Title" error={form.fieldError("title")}>
              <Input
                name="title"
                value={draft.title}
                maxLength={200}
                required
                placeholder="Pay the rent"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </FormField>
            <FormField label="Notes" optional error={form.fieldError("notes")}>
              <Textarea
                name="notes"
                value={draft.notes}
                maxLength={2000}
                rows={3}
                resize="vertical"
                placeholder="Add details"
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </FormField>
            <FormRow>
              <FormField flex="1" label="First date" error={form.fieldError("startsOn")}>
                <Input
                  name="startsOn"
                  type="date"
                  value={draft.startsOn}
                  required
                  onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })}
                />
              </FormField>
              <FormField flex="1" label="Time" error={form.fieldError("timeOfDay")}>
                <Input
                  name="timeOfDay"
                  type="time"
                  step={60}
                  value={draft.timeOfDay}
                  required
                  onChange={(event) => setDraft({ ...draft, timeOfDay: event.target.value })}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField
                flex="1"
                label="Repeat"
                error={form.fieldError("repeatUnit")}
                hint={draft.repeatUnit === "none" ? undefined : `${repeatLabel(draft.repeatUnit, Number.isInteger(interval) && interval > 0 ? interval : 1)}, counted from the first date.`}
              >
                <NativeSelect.Root>
                  <NativeSelect.Field
                    name="repeatUnit"
                    value={draft.repeatUnit}
                    onChange={(event) => setDraft({ ...draft, repeatUnit: event.target.value as RepeatUnit })}
                  >
                    {REPEAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
              {draft.repeatUnit === "none" ? null : (
                <FormField flex="1" label="Every" error={form.fieldError("repeatInterval")}>
                  <Flex align="center" gap="2">
                    <Input
                      name="repeatInterval"
                      type="number"
                      inputMode="numeric"
                      min={MIN_REPEAT_INTERVAL}
                      max={MAX_REPEAT_INTERVAL}
                      step={1}
                      required
                      width="20"
                      value={draft.repeatInterval}
                      onChange={(event) => setDraft({ ...draft, repeatInterval: event.target.value })}
                    />
                    <Text textStyle="bodySm" color="fg.muted">
                      {repeatUnitName(draft.repeatUnit, interval)}
                    </Text>
                  </Flex>
                </FormField>
              )}
            </FormRow>
            <FormField
              label={<span id={leadLabel}>Notify me</span>}
              error={form.fieldError("leadMinutes")}
              hint={`Up to ${MAX_LEAD_TIMES}. ${draft.leadMinutes.length === 0 ? "With none, it only shows here." : ""}`.trim()}
            >
              <div role="group" aria-labelledby={leadLabel}>
                <LeadTimeChips selected={draft.leadMinutes} onChange={(leadMinutes) => setDraft({ ...draft, leadMinutes })} />
              </div>
            </FormField>
            <Switch.Root
              checked={draft.notificationsMuted}
              onCheckedChange={(details) => setDraft({ ...draft, notificationsMuted: details.checked })}
              colorPalette="brand"
              display="flex"
              justifyContent="space-between"
              gap="4"
              width="full"
            >
              <Stack gap="0">
                <Switch.Label textStyle="bodySm" fontWeight="medium">Mute notifications</Switch.Label>
                <Text textStyle="caption">It still shows as due and overdue here.</Text>
              </Stack>
              <Switch.HiddenInput />
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Root>
            {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          </Stack>
        </form>
      </AppDialog>
      {reminder ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={(value) => {
            if (!removal.pending) setConfirming(value);
          }}
          title="Delete this reminder?"
          description={`“${reminder.title}” and its done history will be removed.`}
          cancelLabel="Keep it"
          confirmLabel="Delete reminder"
          pending={removal.pending}
          error={removal.error}
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}

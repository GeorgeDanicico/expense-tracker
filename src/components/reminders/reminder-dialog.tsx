"use client";

import { Button, Stack } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import type { ReminderFields } from "@/components/reminders/reminder-api";
import { draftFor, draftToFields, ReminderFormFields, useShowsExpenseSection, type ReminderDraft } from "@/components/reminders/reminder-form";
import { AppDialog } from "@/components/ui/app-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useAccount } from "@/hooks/use-account";
import { useApiForm } from "@/hooks/use-api-form";
import { getBucharestToday } from "@/lib/calendar";
import { formatDueAt } from "@/lib/reminders/format";
import type { ListedReminder } from "@/lib/reminders/list";

/**
 * Add a reminder, or edit one (with Delete, after a confirmation): title, notes, first date, time,
 * repeat with its interval, up to three lead times, mute, and an optional expense to log when it's
 * marked done (R12). Always sends every field.
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
  const { currency } = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<ReminderDraft>(() => draftFor(reminder, getBucharestToday()));
  const formId = `reminder-${reminder?.id ?? "new"}`;
  const editing = reminder !== undefined;
  const next = reminder ? formatDueAt(reminder) : null;
  const showExpense = useShowsExpenseSection(draft);
  const savedCurrency = reminder?.expenseTemplate && reminder.expenseTemplate.currency !== currency
    ? reminder.expenseTemplate.currency
    : null;

  function save() {
    void form.submit(async () => {
      await onSave(draftToFields(draft, currency));
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
        fullHeightOnPhone
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
            <ReminderFormFields
              draft={draft}
              onChange={setDraft}
              fieldError={form.fieldError}
              currency={currency}
              showExpense={showExpense}
              savedCurrency={savedCurrency}
            />
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

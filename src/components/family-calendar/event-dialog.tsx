"use client";

import { Button, Stack } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import type { ColorOf } from "@/components/family-calendar/event-appearance";
import { EventFormFields, peopleFor } from "@/components/family-calendar/event-form";
import { seriesLabel } from "@/components/family-calendar/event-row";
import { ScopeDialog } from "@/components/family-calendar/scope-dialog";
import { AppDialog } from "@/components/ui/app-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { ApiError } from "@/lib/api/client";
import type { FamilyMemberView } from "@/lib/family/views";
import { draftFromEvent, newDraft, parseEdit, parseNewEvent, type EventDraft } from "@/lib/family-calendar/form";
import type { CalendarEvent, EditScope } from "@/lib/family-calendar/types";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";
import type { FieldErrors } from "@/lib/validation/field-errors";

export type EventDialogMode =
  | {
    kind: "create";
    date: string;
    /** A start time to open with, from the Week view's hourly grid. */
    startTime?: string;
    /** Open as an all-day event, from the Week view's all-day row. */
    allDay?: boolean;
    /** Who's going to start with, when the calendar is filtered to someone; just the caller otherwise. */
    attendeeMemberIds?: string[];
  }
  | { kind: "edit"; event: CalendarEvent };

/**
 * The form to add an event or edit one. Fields: title, all-day, start and end, who's going (member
 * chips and Everyone; just you by default), repeat (when adding), place and notes. Moving the start
 * moves the end with it. Editing an event in a series asks which events first
 * (`ScopeDialog`); so does Delete, which only an existing event has. A repeat can't change once
 * the event exists, so editing doesn't offer one.
 */
export function EventDialog({
  mode,
  members,
  myMemberId,
  colorOf,
  open,
  onOpenChange,
  onCreate,
  onUpdate,
  onRemove,
}: {
  mode: EventDialogMode;
  members: readonly FamilyMemberView[];
  myMemberId: string | null;
  colorOf: ColorOf;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CalendarEventInput) => Promise<unknown>;
  onUpdate: (id: string, edit: CalendarEventEdit) => Promise<unknown>;
  onRemove: (id: string, scope: EditScope) => Promise<unknown>;
}) {
  const editing = mode.kind === "edit";
  const event = mode.kind === "edit" ? mode.event : null;
  const form = useApiForm();
  const removal = useApiForm();
  const titleRef = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState<"save" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(() => mode.kind === "edit"
    ? draftFromEvent(mode.event)
    : newDraft({
      date: mode.date,
      startTime: mode.startTime,
      allDay: mode.allDay,
      attendeeMemberIds: mode.attendeeMemberIds ?? (myMemberId ? [myMemberId] : []),
    }));
  const formId = `event-${event?.id ?? "new"}`;
  const inSeries = (event?.seriesLength ?? 1) > 1;

  const people = peopleFor(members, event?.attendees);

  /** A mistake the form found itself, shown on its fields the way the API's would be. */
  function refuse(fieldErrors: FieldErrors): never {
    throw new ApiError("Check the highlighted details and try again.", 422, fieldErrors);
  }

  function save(scope?: EditScope) {
    void form.submit(async () => {
      if (!event) {
        const parsed = parseNewEvent(draft);
        if (!parsed.ok) refuse(parsed.fieldErrors);
        await onCreate(parsed.value);
        onOpenChange(false);
        return;
      }

      const parsed = parseEdit(event, draft, scope ?? "this");
      if (parsed === null) {
        onOpenChange(false);
        return;
      }
      if (!parsed.ok) refuse(parsed.fieldErrors);
      // Which events? Ask before saving anything, once the edit is known to be valid.
      if (inSeries && scope === undefined) {
        setAsking("save");
        return;
      }
      await onUpdate(event.id, parsed.value);
      setAsking(null);
      onOpenChange(false);
    }, { fallback: "The event could not be saved." });
  }

  function remove(scope: EditScope) {
    if (!event) return;
    void removal.submit(async () => {
      await onRemove(event.id, scope);
      setAsking(null);
      setConfirming(false);
      onOpenChange(false);
    }, { fallback: "The event could not be deleted." });
  }

  const description = event
    ? (seriesLabel(event)
      ? `Event ${seriesLabel(event)} in a ${event.seriesRepeat === "weekly" ? "weekly" : "daily"} series. Times are Bucharest time.`
      : "Times are Bucharest time.")
    : "Everyone in the family sees it. Times are Bucharest time.";

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={(next) => {
          if (!form.pending && !removal.pending) onOpenChange(next);
        }}
        title={editing ? "Edit event" : "Add event"}
        description={description}
        fullHeightOnPhone
        initialFocusEl={() => (editing ? null : titleRef.current)}
        footer={(
          <FormActions
            submitLabel={editing ? "Save event" : "Add event"}
            form={formId}
            closesDialog
            pending={form.pending}
            leading={editing ? (
              <Button
                variant="ghost"
                size={{ base: "md", sm: "sm" }}
                colorPalette="danger"
                onClick={() => (inSeries ? setAsking("delete") : setConfirming(true))}
                disabled={form.pending}
              >
                <Trash2 size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Delete
              </Button>
            ) : undefined}
          />
        )}
      >
        <form
          id={formId}
          onSubmit={(submitted) => {
            submitted.preventDefault();
            save();
          }}
        >
          <Stack gap="3">
            <EventFormFields
              draft={draft}
              onChange={setDraft}
              people={people}
              myMemberId={myMemberId}
              colorOf={colorOf}
              fieldError={form.fieldError}
              editing={editing}
              titleRef={titleRef}
            />
            {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          </Stack>
        </form>
      </AppDialog>
      {event ? (
        <>
          <ScopeDialog
            event={event}
            action={asking === "delete" ? "delete" : "edit"}
            open={asking !== null}
            onOpenChange={(next) => {
              if (!next) setAsking(null);
            }}
            pending={form.pending || removal.pending}
            error={asking === "delete" ? removal.error : form.error}
            onChoose={(scope) => (asking === "delete" ? remove(scope) : save(scope))}
          />
          <ConfirmDialog
            open={confirming}
            onOpenChange={(next) => {
              if (!removal.pending) setConfirming(next);
            }}
            title="Delete this event?"
            description={`“${event.title}” will be removed from the family calendar for everyone.`}
            cancelLabel="Keep it"
            confirmLabel="Delete event"
            pending={removal.pending}
            error={removal.error}
            onConfirm={() => remove("this")}
          />
        </>
      ) : null}
    </>
  );
}

"use client";

import { Button, chakra, Flex, Input, NativeSelect, Stack, Switch, Text, Textarea } from "@chakra-ui/react";
import { Trash2, Users } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { ColorOf } from "@/components/family-calendar/event-appearance";
import { seriesLabel } from "@/components/family-calendar/event-row";
import { ScopeDialog } from "@/components/family-calendar/scope-dialog";
import { AppDialog } from "@/components/ui/app-dialog";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { ApiError } from "@/lib/api/client";
import { addDays } from "@/lib/calendar";
import type { FamilyMember } from "@/lib/family/repository";
import {
  clampRepeatCount,
  draftFromEvent,
  newDraft,
  parseEdit,
  parseNewEvent,
  toggleAttendee,
  withAllDay,
  withStart,
  type EventDraft,
  type FieldErrors,
} from "@/lib/family-calendar/form";
import { MAX_SERIES_LENGTH, MIN_REPEAT_COUNT, type CalendarEvent, type EditScope, type SeriesRepeat } from "@/lib/family-calendar/types";
import { dayHeading } from "@/lib/family-calendar/view";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";

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

type Person = { memberId: string; name: string; avatarUrl: string | null };

const REPEAT_OPTIONS: { value: SeriesRepeat; label: string }[] = [
  { value: "none", label: "Doesn't repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

function memberName(member: FamilyMember) {
  return member.displayName ?? member.username ?? "Family member";
}

/** What "Who's going" says about the chosen people. */
export function goingSummary(people: readonly Person[], selected: readonly string[], myMemberId: string | null) {
  if (selected.length === 0) return "Choose at least one person.";
  if (people.length > 1 && people.every((person) => selected.includes(person.memberId))) return "Everyone";
  if (selected.length === 1 && selected[0] === myMemberId) return "Just me";
  const names = people.filter((person) => selected.includes(person.memberId)).map((person) => person.name);
  return names.join(", ");
}

/** The last date of a repeat of `count` from `startDate`, for the hint under Repeat. */
export function repeatEndsOn(startDate: string, kind: SeriesRepeat, count: number) {
  return addDays(startDate, (kind === "weekly" ? 7 : 1) * (count - 1));
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      size="sm"
      variant={pressed ? "solid" : "outline"}
      colorPalette={pressed ? "brand" : undefined}
      aria-pressed={pressed}
      flexShrink="0"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

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
  members: readonly FamilyMember[];
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
  const goingLabel = useId();
  const formId = `event-${event?.id ?? "new"}`;
  const inSeries = (event?.seriesLength ?? 1) > 1;

  // Members of the family, plus anyone going who has since left it, so their chip stays to be seen.
  const people: Person[] = [
    ...members.map((member) => ({ memberId: member.memberId, name: memberName(member), avatarUrl: member.avatarUrl })),
    ...(event?.attendees ?? [])
      .filter((attendee) => !members.some((member) => member.memberId === attendee.memberId))
      .map((attendee) => ({ memberId: attendee.memberId, name: attendee.name ?? "Former member", avatarUrl: attendee.avatarUrl })),
  ];
  const everyone = people.length > 0 && people.every((person) => draft.attendeeMemberIds.includes(person.memberId));
  const count = clampRepeatCount(draft.repeatCount);

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
            <FormField label="Title" error={form.fieldError("title")}>
              <Input
                ref={titleRef}
                name="title"
                value={draft.title}
                maxLength={200}
                required
                placeholder="Swimming"
                onChange={(changed) => setDraft({ ...draft, title: changed.target.value })}
              />
            </FormField>

            <Switch.Root
              checked={draft.allDay}
              onCheckedChange={(details) => setDraft(withAllDay(draft, details.checked))}
              colorPalette="brand"
              display="flex"
              justifyContent="space-between"
              gap="4"
              width="full"
            >
              <Switch.Label textStyle="bodySm" fontWeight="medium">All day</Switch.Label>
              <Switch.HiddenInput name="allDay" />
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Root>

            <FormField label={draft.allDay ? "First day" : "Starts"} error={form.fieldError("startDate") ?? form.fieldError("startTime")}>
              <Flex gap="2">
                <Input
                  flex="1"
                  minW="0"
                  name="startDate"
                  type="date"
                  aria-label={draft.allDay ? "First day" : "Start date"}
                  value={draft.startDate}
                  required
                  onChange={(changed) => setDraft(withStart(draft, { startDate: changed.target.value }))}
                />
                {draft.allDay ? null : (
                  <Input
                    w="8.5rem"
                    flexShrink="0"
                    name="startTime"
                    type="time"
                    step={60}
                    aria-label="Start time"
                    value={draft.startTime}
                    required
                    onChange={(changed) => setDraft(withStart(draft, { startTime: changed.target.value }))}
                  />
                )}
              </Flex>
            </FormField>
            <FormField label={draft.allDay ? "Last day" : "Ends"} error={form.fieldError("endDate") ?? form.fieldError("endTime")}>
              <Flex gap="2">
                <Input
                  flex="1"
                  minW="0"
                  name="endDate"
                  type="date"
                  aria-label={draft.allDay ? "Last day" : "End date"}
                  value={draft.endDate}
                  min={draft.startDate || undefined}
                  required
                  onChange={(changed) => setDraft({ ...draft, endDate: changed.target.value })}
                />
                {draft.allDay ? null : (
                  <Input
                    w="8.5rem"
                    flexShrink="0"
                    name="endTime"
                    type="time"
                    step={60}
                    aria-label="End time"
                    value={draft.endTime}
                    required
                    onChange={(changed) => setDraft({ ...draft, endTime: changed.target.value })}
                  />
                )}
              </Flex>
            </FormField>

            <FormField
              label={<chakra.span id={goingLabel}>Who&apos;s going</chakra.span>}
              error={form.fieldError("attendeeMemberIds")}
              hint={goingSummary(people, draft.attendeeMemberIds, myMemberId)}
            >
              <Flex gap="2" wrap="wrap" role="group" aria-labelledby={goingLabel}>
                <Chip
                  pressed={everyone}
                  onClick={() => setDraft({
                    ...draft,
                    attendeeMemberIds: everyone && myMemberId ? [myMemberId] : people.map((person) => person.memberId),
                  })}
                >
                  <Users size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  Everyone
                </Chip>
                {people.map((person) => (
                  <Chip
                    key={person.memberId}
                    pressed={draft.attendeeMemberIds.includes(person.memberId)}
                    onClick={() => setDraft(toggleAttendee(draft, person.memberId))}
                  >
                    <Avatar size="xs" name={person.name} src={person.avatarUrl} color={colorOf(person.memberId)} decorative />
                    {person.memberId === myMemberId ? "Me" : person.name}
                  </Chip>
                ))}
              </Flex>
            </FormField>

            {editing ? null : (
              <FormRow>
                <FormField
                  flex="1"
                  label="Repeat"
                  error={form.fieldError("repeat")}
                  hint={draft.repeatKind === "none"
                    ? undefined
                    : `${count} events, to ${dayHeading(repeatEndsOn(draft.startDate, draft.repeatKind, count))}.`}
                >
                  <Flex align="center" gap="2" wrap="wrap">
                    <NativeSelect.Root flex="1" minW="9rem">
                      <NativeSelect.Field
                        name="repeatKind"
                        value={draft.repeatKind}
                        onChange={(changed) => setDraft({ ...draft, repeatKind: changed.target.value as SeriesRepeat })}
                      >
                        {REPEAT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                    {draft.repeatKind === "none" ? null : (
                      <Flex align="center" gap="2">
                        <Text textStyle="bodySm" color="fg.muted">for</Text>
                        <Input
                          name="repeatCount"
                          type="number"
                          inputMode="numeric"
                          aria-label={`Number of ${draft.repeatKind === "weekly" ? "weeks" : "days"}`}
                          min={MIN_REPEAT_COUNT}
                          max={MAX_SERIES_LENGTH}
                          step={1}
                          width="20"
                          value={draft.repeatCount}
                          onChange={(changed) => setDraft({ ...draft, repeatCount: Number(changed.target.value) })}
                          onBlur={() => setDraft({ ...draft, repeatCount: count })}
                        />
                        <Text textStyle="bodySm" color="fg.muted">{draft.repeatKind === "weekly" ? "weeks" : "days"}</Text>
                      </Flex>
                    )}
                  </Flex>
                </FormField>
              </FormRow>
            )}

            <FormField label="Location" optional error={form.fieldError("location")}>
              <Input
                name="location"
                value={draft.location}
                maxLength={200}
                placeholder="Olympic pool"
                onChange={(changed) => setDraft({ ...draft, location: changed.target.value })}
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
                onChange={(changed) => setDraft({ ...draft, notes: changed.target.value })}
              />
            </FormField>
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

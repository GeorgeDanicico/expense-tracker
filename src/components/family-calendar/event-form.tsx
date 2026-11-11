"use client";

import { chakra, Flex, Input, NativeSelect, Stack, Switch, Text, Textarea } from "@chakra-ui/react";
import { Users } from "lucide-react";
import { useId, useRef, useState, type RefObject } from "react";

import type { ColorOf } from "@/components/family-calendar/event-appearance";
import { useCalendarWrites } from "@/components/family-calendar/use-calendar-events";
import { Avatar } from "@/components/ui/avatar";
import { ChipMenu } from "@/components/ui/chip-menu";
import { Disclosure } from "@/components/ui/disclosure";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { SheetForm, useSheetSave } from "@/components/ui/save-button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useAccount } from "@/hooks/use-account";
import { useFamily } from "@/hooks/use-family";
import { useMemberColors } from "@/hooks/use-member-colors";
import { ApiError } from "@/lib/api/client";
import { addDays, getBucharestToday } from "@/lib/calendar";
import type { FamilyMemberView } from "@/lib/family/views";
import {
  clampRepeatCount,
  newDraft,
  parseNewEvent,
  toggleAttendee,
  withAllDay,
  withStart,
  type EventDraft,
} from "@/lib/family-calendar/form";
import { MAX_SERIES_LENGTH, MIN_REPEAT_COUNT, type CalendarEvent, type SeriesRepeat } from "@/lib/family-calendar/types";
import { dayHeading } from "@/lib/family-calendar/view";

export type Person = { memberId: string; name: string; avatarUrl: string | null };

const REPEAT_OPTIONS: { value: SeriesRepeat; label: string }[] = [
  { value: "none", label: "Doesn't repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

function memberName(member: FamilyMemberView) {
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

/** The family's members as the form lists them, plus `attendees` who have since left, so their chip stays to be seen. */
export function peopleFor(members: readonly FamilyMemberView[], attendees: CalendarEvent["attendees"] = []): Person[] {
  return [
    ...members.map((member) => ({ memberId: member.memberId, name: memberName(member), avatarUrl: member.avatarUrl })),
    ...attendees
      .filter((attendee) => !members.some((member) => member.memberId === attendee.memberId))
      .map((attendee) => ({ memberId: attendee.memberId, name: attendee.name ?? "Former member", avatarUrl: attendee.avatarUrl })),
  ];
}

const PICK = "pick";

/**
 * An event's fields, the one form for an event. In full (its dialog): title, all-day, start and
 * end, who's going (member chips and Everyone), repeat (when adding), place and notes; moving the
 * start moves the end with it. `compact` (the quick-add sheet): the title, the day and the time as
 * chips (all day unless a time is chosen), who's going, and the repeat, place and notes behind
 * "More options".
 */
export function EventFormFields({
  draft,
  onChange,
  people,
  myMemberId,
  colorOf,
  fieldError,
  editing = false,
  compact = false,
  titleRef,
}: {
  draft: EventDraft;
  onChange: (draft: EventDraft) => void;
  people: readonly Person[];
  myMemberId: string | null;
  colorOf: ColorOf;
  fieldError: (name: string) => string | undefined;
  /** An existing event: its repeat can't change, so none is offered. */
  editing?: boolean;
  compact?: boolean;
  titleRef?: RefObject<HTMLInputElement | null>;
}) {
  const goingLabel = useId();
  const [choosing, setChoosing] = useState(false);
  const everyone = people.length > 0 && people.every((person) => draft.attendeeMemberIds.includes(person.memberId));
  const count = clampRepeatCount(draft.repeatCount);

  const title = (
    <FormField label="Title" labelHidden={compact} error={fieldError("title")}>
      <Input
        ref={titleRef}
        size={compact ? "md" : undefined}
        autoFocus={compact}
        name="title"
        value={draft.title}
        maxLength={200}
        required
        placeholder={compact ? "What's happening?" : "Swimming"}
        onChange={(changed) => onChange({ ...draft, title: changed.target.value })}
      />
    </FormField>
  );
  const allDay = (
    <Switch.Root
      checked={draft.allDay}
      onCheckedChange={(details) => onChange(withAllDay(draft, details.checked))}
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
  );
  const startAndEnd = (
    <>
      <FormField label={draft.allDay ? "First day" : "Starts"} error={fieldError("startDate") ?? fieldError("startTime")}>
        <Flex gap="2">
          <Input
            flex="1"
            minW="0"
            name="startDate"
            type="date"
            aria-label={draft.allDay ? "First day" : "Start date"}
            value={draft.startDate}
            required
            onChange={(changed) => onChange(withStart(draft, { startDate: changed.target.value }))}
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
              onChange={(changed) => onChange(withStart(draft, { startTime: changed.target.value }))}
            />
          )}
        </Flex>
      </FormField>
      <FormField label={draft.allDay ? "Last day" : "Ends"} error={fieldError("endDate") ?? fieldError("endTime")}>
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
            onChange={(changed) => onChange({ ...draft, endDate: changed.target.value })}
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
              onChange={(changed) => onChange({ ...draft, endTime: changed.target.value })}
            />
          )}
        </Flex>
      </FormField>

    </>
  );
  const going = (
    <FormField
      label={<chakra.span id={goingLabel}>Who&apos;s going</chakra.span>}
      error={fieldError("attendeeMemberIds")}
      hint={goingSummary(people, draft.attendeeMemberIds, myMemberId)}
    >
      <Flex gap="2" wrap="wrap" role="group" aria-labelledby={goingLabel}>
        <ToggleChip
          pressed={everyone}
          onClick={() => onChange({
            ...draft,
            attendeeMemberIds: everyone && myMemberId ? [myMemberId] : people.map((person) => person.memberId),
          })}
        >
          <Users size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Everyone
        </ToggleChip>
        {people.map((person) => (
          <ToggleChip
            key={person.memberId}
            pressed={draft.attendeeMemberIds.includes(person.memberId)}
            onClick={() => onChange(toggleAttendee(draft, person.memberId))}
          >
            <Avatar size="xs" name={person.name} src={person.avatarUrl} color={colorOf(person.memberId)} decorative />
            {person.memberId === myMemberId ? "Me" : person.name}
          </ToggleChip>
        ))}
      </Flex>
    </FormField>
  );
  const repeat = (

      <FormRow>
        <FormField
          flex="1"
          label="Repeat"
          error={fieldError("repeat")}
          hint={draft.repeatKind === "none"
            ? undefined
            : `${count} events, to ${dayHeading(repeatEndsOn(draft.startDate, draft.repeatKind, count))}.`}
        >
          <Flex align="center" gap="2" wrap="wrap">
            <NativeSelect.Root flex="1" minW="9rem">
              <NativeSelect.Field
                name="repeatKind"
                value={draft.repeatKind}
                onChange={(changed) => onChange({ ...draft, repeatKind: changed.target.value as SeriesRepeat })}
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
                  onChange={(changed) => onChange({ ...draft, repeatCount: Number(changed.target.value) })}
                  onBlur={() => onChange({ ...draft, repeatCount: count })}
                />
                <Text textStyle="bodySm" color="fg.muted">{draft.repeatKind === "weekly" ? "weeks" : "days"}</Text>
              </Flex>
            )}
          </Flex>
        </FormField>
      </FormRow>
  );
  const location = (
    <FormField label="Location" optional error={fieldError("location")}>
      <Input
        name="location"
        value={draft.location}
        maxLength={200}
        placeholder="Olympic pool"
        onChange={(changed) => onChange({ ...draft, location: changed.target.value })}
      />
    </FormField>
  );
  const notes = (
    <FormField label="Notes" optional error={fieldError("notes")}>
      <Textarea
        name="notes"
        value={draft.notes}
        maxLength={2000}
        rows={3}
        resize="vertical"
        placeholder="Add details"
        onChange={(changed) => onChange({ ...draft, notes: changed.target.value })}
      />
    </FormField>
  );

  if (!compact) {
    return (
      <Stack gap="3">
        {title}
        {allDay}
        {startAndEnd}
        {going}
        {editing ? null : repeat}
        {location}
        {notes}
      </Stack>
    );
  }

  const today = getBucharestToday();
  const days = [
    { value: today, label: "Today" },
    { value: addDays(today, 1), label: "Tomorrow" },
  ];
  const dayLabel = days.find((day) => day.value === draft.startDate)?.label ?? dayHeading(draft.startDate);
  return (
    <Stack gap="3">
      {title}
      <Flex gap="2" wrap="wrap">
        <ChipMenu
          aria-label={`Day: ${dayLabel}`}
          label={dayLabel}
          items={[...days, { value: PICK, label: "Pick a date…" }]}
          onSelect={(value) => {
            if (value === PICK) setChoosing(true);
            else onChange(withStart(draft, { startDate: value }));
          }}
        />
        <ChipMenu
          aria-label={draft.allDay ? "Time: all day" : `Time: ${draft.startTime}`}
          label={draft.allDay ? "All day" : `${draft.startTime}–${draft.endTime}`}
          items={[{ value: "all", label: "All day" }, { value: PICK, label: "Choose a time…" }]}
          onSelect={(value) => {
            onChange(withAllDay(draft, value === "all"));
            if (value === PICK) setChoosing(true);
          }}
        />
      </Flex>
      {choosing || !draft.allDay || fieldError("startDate") || fieldError("endDate") ? startAndEnd : null}
      {going}
      <Disclosure label="More options">
        {repeat}
        {location}
        {notes}
      </Disclosure>
    </Stack>
  );
}

/**
 * A new event from the quick-add sheet (only with a family): `EventFormFields` in compact mode,
 * today, all day and for everyone unless changed (decision 7 in docs/ui-direction.md). It shows at
 * once in every cached calendar range (`useCalendarWrites`).
 */
export function NewEventForm({ onSaved }: { onSaved: (events: CalendarEvent[], another: boolean) => void }) {
  const { account } = useAccount();
  const myMemberId = account?.membership?.memberId ?? null;
  const { data: family } = useFamily(Boolean(account?.membership));
  const members = family?.family?.members ?? [];
  const writes = useCalendarWrites(members);
  const colorOf = useMemberColors();
  const titleRef = useRef<HTMLInputElement>(null);
  const { form, saved, save: run } = useSheetSave();
  const [draft, setDraft] = useState<EventDraft>(() => newDraft({ date: getBucharestToday(), allDay: true, attendeeMemberIds: myMemberId ? [myMemberId] : [] }));
  const people = peopleFor(members);
  // Everyone by default, once the family has loaded and while nobody else was chosen.
  const [defaulted, setDefaulted] = useState(false);
  if (!defaulted && people.length > 0) {
    setDefaulted(true);
    setDraft({ ...draft, attendeeMemberIds: people.map((person) => person.memberId) });
  }

  function save(another: boolean) {
    run(another, async () => {
      const parsed = parseNewEvent(draft);
      if (!parsed.ok) throw new ApiError("Check the highlighted details and try again.", 422, parsed.fieldErrors);
      return writes.create(parsed.value);
    }, (events, cleared) => {
      if (cleared) setDraft({ ...draft, title: "", notes: "", location: "" });
      onSaved(events, cleared);
    });
  }

  return (
    <SheetForm label="Add event" form={form} saved={saved} onSave={save}>
      <EventFormFields
        compact
        draft={draft}
        onChange={setDraft}
        people={people}
        myMemberId={myMemberId}
        colorOf={colorOf}
        fieldError={form.fieldError}
        titleRef={titleRef}
      />
    </SheetForm>
  );
}

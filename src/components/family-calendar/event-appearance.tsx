import { Box, Flex } from "@chakra-ui/react";

import { Avatar } from "@/components/ui/avatar";
import { timeLabel } from "@/lib/family-calendar/days";
import type { CalendarAttendee, CalendarEvent } from "@/lib/family-calendar/types";

/** A member's colour for a member id (`useMemberColors()`), or undefined while the family loads. */
export type ColorOf = (memberId: string | null | undefined) => string | undefined;

export type EventAppearance = {
  /** The chip's background token. */
  bg: string;
  /** Its text token, readable on `bg`. */
  color: string;
  /** Drawn in the neutral family colour (several people going, or no palette colour to use). */
  neutral: boolean;
};

const PALETTE_SLOT = /^member\.[1-8]$/;

/**
 * How an event is coloured: with one attendee, in that member's colour (their text token is
 * paired to be readable on it); with several, in the neutral family colour, which the views pair
 * with the attendees' avatars. A single attendee past the eighth member has no palette colour of
 * their own and gets the neutral one too.
 */
export function eventAppearance(event: Pick<CalendarEvent, "attendees">, colorOf: ColorOf): EventAppearance {
  const only = event.attendees.length === 1 ? colorOf(event.attendees[0].memberId) : undefined;
  return only && PALETTE_SLOT.test(only)
    ? { bg: only, color: `${only}.fg`, neutral: false }
    : { bg: "bg.emphasized", color: "fg", neutral: true };
}

/** The colour of an event's dot in the phone's month: the member's, or a neutral grey for an event with several people. */
export function eventDotColor(event: Pick<CalendarEvent, "attendees">, colorOf: ColorOf) {
  const appearance = eventAppearance(event, colorOf);
  return appearance.neutral ? "fg.subtle" : appearance.bg;
}

export function attendeeName(attendee: Pick<CalendarAttendee, "name">) {
  return attendee.name ?? "A family member";
}

/** "Ana, Maria and Luca": the attendees' names, for labels. */
export function attendeeNames(attendees: readonly CalendarAttendee[]) {
  const names = attendees.map(attendeeName);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The label a screen reader gets for an event chip: what, when, who. */
export function eventLabel(event: CalendarEvent) {
  const series = event.seriesLength > 1 ? `, ${event.seriesIndex} of ${event.seriesLength}` : "";
  return `${event.title}, ${timeLabel(event)}${series}, ${attendeeNames(event.attendees)}`;
}

/** The attendees' avatars side by side, overlapping, with "+N" when there are more than `max`. */
export function AttendeeAvatars({
  attendees,
  colorOf,
  max = 4,
}: {
  attendees: readonly CalendarAttendee[];
  colorOf: ColorOf;
  max?: number;
}) {
  const shown = attendees.slice(0, max);
  return (
    <Flex align="center" aria-label={`Going: ${attendeeNames(attendees)}`} role="group">
      {shown.map((attendee, index) => (
        <Box key={attendee.memberId} ms={index === 0 ? "0" : "-1.5"} borderRadius="full" borderWidth="2px" borderColor="bg.surface" lineHeight="0">
          <Avatar size="xs" name={attendeeName(attendee)} src={attendee.avatarUrl} color={colorOf(attendee.memberId)} />
        </Box>
      ))}
      {attendees.length > max ? (
        <Box as="span" ms="1" textStyle="label" color="fg.muted">+{attendees.length - max}</Box>
      ) : null}
    </Flex>
  );
}

/** A colour dot per attendee, overlapping: the month grid's chips are too short for avatars. */
export function AttendeeDots({ attendees, colorOf, max = 3 }: { attendees: readonly CalendarAttendee[]; colorOf: ColorOf; max?: number }) {
  return (
    <Flex align="center" flexShrink="0" aria-hidden="true">
      {attendees.slice(0, max).map((attendee, index) => (
        <Box
          key={attendee.memberId}
          boxSize="2.5"
          borderRadius="full"
          bg={colorOf(attendee.memberId) ?? "fg.subtle"}
          borderWidth="1px"
          borderColor="bg.surface"
          ms={index === 0 ? "0" : "-1"}
        />
      ))}
    </Flex>
  );
}

"use client";

import { Box, Flex, Text } from "@chakra-ui/react";
import { MapPin, Repeat } from "lucide-react";

import {
  AttendeeAvatars,
  eventAppearance,
  eventLabel,
  type ColorOf,
} from "@/components/family-calendar/event-appearance";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { dayTimeLabel } from "@/lib/family-calendar/days";
import { isPendingEvent } from "@/lib/family-calendar/optimistic";
import type { CalendarEvent } from "@/lib/family-calendar/types";

/** "3 of 6" for an occurrence of a repeating event; null for a one-off. */
export function seriesLabel(event: Pick<CalendarEvent, "seriesIndex" | "seriesLength">) {
  return event.seriesLength > 1 ? `${event.seriesIndex} of ${event.seriesLength}` : null;
}

/**
 * One event as a row for the Agenda and the day list: a stripe in the event's colour, its time on
 * `date`, title, place, "3 of 6" for a series, and who's going as avatars. Opens the event.
 */
export function EventRow({
  event,
  date,
  colorOf,
  onOpen,
}: {
  event: CalendarEvent;
  /** The day it is listed under, for the time shown on a multi-day event. */
  date: string;
  colorOf: ColorOf;
  onOpen: (event: CalendarEvent) => void;
}) {
  const appearance = eventAppearance(event, colorOf);
  const series = seriesLabel(event);
  return (
    <Flex
      as="button"
      align="center"
      gap="3"
      w="full"
      minW="0"
      textAlign="start"
      cursor="pointer"
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border"
      borderRadius="control"
      overflow="hidden"
      opacity={isPendingEvent(event) ? 0.6 : 1}
      outline="none"
      aria-label={eventLabel(event)}
      onClick={() => onOpen(event)}
      _hover={{ borderColor: "border.strong", bg: "bg.subtle" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "2px" }}
    >
      <Box alignSelf="stretch" w="1.5" flexShrink="0" bg={appearance.neutral ? "fg.subtle" : appearance.bg} aria-hidden="true" />
      <Text textStyle="label" color="fg.muted" w={{ base: "5.5rem", sm: "8rem" }} flexShrink="0" py="2" aria-hidden="true">
        {dayTimeLabel(event, date)}
      </Text>
      <Box flex="1" minW="0" py="2">
        <Text textStyle="bodySm" fontWeight="medium" truncate>{event.title}</Text>
        {event.location || series ? (
          <Flex gap="3" textStyle="caption" wrap="wrap">
            {event.location ? (
              <Flex align="center" gap="1" minW="0">
                <MapPin size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <Text as="span" truncate>{event.location}</Text>
              </Flex>
            ) : null}
            {series ? (
              <Flex align="center" gap="1">
                <Repeat size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <Text as="span">{series}</Text>
              </Flex>
            ) : null}
          </Flex>
        ) : null}
      </Box>
      <Box pe="3" flexShrink="0">
        <AttendeeAvatars attendees={event.attendees} colorOf={colorOf} />
      </Box>
    </Flex>
  );
}

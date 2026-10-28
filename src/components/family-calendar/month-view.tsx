"use client";

import { Box, Grid } from "@chakra-ui/react";
import { memo, useMemo } from "react";

import {
  AttendeeDots,
  eventAppearance,
  eventLabel,
  type ColorOf,
} from "@/components/family-calendar/event-appearance";
import { eventLengthInDays, localTime } from "@/lib/family-calendar/days";
import { isPendingEvent } from "@/lib/family-calendar/optimistic";
import { layoutMonthWeek, MONTH_MAX_LANES, type WeekSegment } from "@/lib/family-calendar/month-layout";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import { longDate, monthGridWeeks } from "@/lib/family-calendar/view";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The grid's rows: the day number, one row per chip lane, and the "+N more" row. */
const ROWS = `1.75rem repeat(${MONTH_MAX_LANES}, 1.375rem) 1.25rem`;
const COLUMNS = "repeat(7, minmax(0, 1fr))";

/** One event's stretch of a week: a chip that keeps the same row on every day it covers. */
function Chip({
  segment,
  colorOf,
  onOpen,
}: {
  segment: WeekSegment;
  colorOf: ColorOf;
  onOpen: (event: CalendarEvent) => void;
}) {
  const { event, startsBeforeWeek, endsAfterWeek } = segment;
  const appearance = eventAppearance(event, colorOf);
  // A timed event shows its start time; one that spans days or all day reads as a bar.
  const timed = !event.allDay && eventLengthInDays(event) === 1;
  return (
    <Box
      as="button"
      display="flex"
      alignItems="center"
      minW="0"
      px="1.5"
      gap="1"
      cursor="pointer"
      textAlign="start"
      fontWeight="medium"
      textStyle="label"
      bg={appearance.bg}
      color={appearance.color}
      borderWidth={appearance.neutral ? "1px" : "0"}
      borderColor="border.strong"
      borderStartRadius={startsBeforeWeek ? "0" : "control"}
      borderEndRadius={endsAfterWeek ? "0" : "control"}
      opacity={isPendingEvent(event) ? 0.6 : 1}
      aria-label={eventLabel(event)}
      onClick={() => onOpen(event)}
      gridColumn={`${segment.column + 1} / span ${segment.span}`}
      gridRow={segment.lane + 2}
      ms={startsBeforeWeek ? "0" : "0.5"}
      me={endsAfterWeek ? "0" : "0.5"}
      pointerEvents="auto"
      overflow="hidden"
      outline="none"
      _hover={{ filter: "brightness(0.95)" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "1px" }}
    >
      {event.attendees.length > 1 ? <AttendeeDots attendees={event.attendees} colorOf={colorOf} /> : null}
      <Box as="span" truncate minW="0">
        {timed ? <Box as="span" fontWeight="normal" me="1">{localTime(event.startsAt, event.timezone)}</Box> : null}
        {event.title}
      </Box>
    </Box>
  );
}

/** One week of the grid: day cells to click, the chips laid over them, and "+N more" where chips ran out. */
const Week = memo(function Week({
  days,
  month,
  today,
  events,
  colorOf,
  onOpenEvent,
  onAddOnDay,
  onOpenDay,
}: {
  days: string[];
  month: string;
  today: string;
  events: readonly CalendarEvent[];
  colorOf: ColorOf;
  onOpenEvent: (event: CalendarEvent) => void;
  onAddOnDay: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const layout = useMemo(() => layoutMonthWeek(events, days[0]), [events, days]);

  return (
    <Box position="relative" borderTopWidth="1px" borderColor="border">
      <Grid position="absolute" inset="0" templateColumns={COLUMNS}>
        {days.map((date, column) => (
          <Box
            key={date}
            as="button"
            // Adding on a day is a mouse shortcut; the Add event button is the keyboard route.
            tabIndex={-1}
            aria-label={`Add an event on ${longDate(date)}`}
            onClick={() => onAddOnDay(date)}
            cursor="pointer"
            borderInlineStartWidth={column === 0 ? "0" : "1px"}
            borderColor="border"
            bg={date === today ? "bg.selected" : date.slice(0, 7) === month ? "bg.surface" : "bg.subtle"}
            _hover={{ bg: date === today ? "bg.selected" : "bg.muted" }}
          />
        ))}
      </Grid>
      <Grid position="relative" templateColumns={COLUMNS} templateRows={ROWS} pointerEvents="none" pb="1">
        {days.map((date, column) => {
          const isToday = date === today;
          const inMonth = date.slice(0, 7) === month;
          return (
            <Box key={date} gridColumn={column + 1} gridRow="1" display="flex" alignItems="center" px="1.5" minW="0">
              <Box
                as="button"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                h="5"
                minW="5"
                px="1"
                borderRadius="full"
                cursor="pointer"
                textStyle="label"
                fontWeight={isToday ? "semibold" : "medium"}
                bg={isToday ? "brand.solid" : "transparent"}
                color={isToday ? "brand.contrast" : inMonth ? "fg" : "fg.subtle"}
                aria-label={`Show ${longDate(date)}${isToday ? " (today)" : ""}`}
                aria-current={isToday ? "date" : undefined}
                pointerEvents="auto"
                outline="none"
                onClick={() => onOpenDay(date)}
                _hover={isToday ? undefined : { bg: "bg.emphasized" }}
                _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "1px" }}
              >
                {Number(date.slice(8))}
              </Box>
            </Box>
          );
        })}
        {layout.segments.map((segment) => (
          <Chip key={`${segment.event.id}-${segment.column}`} segment={segment} colorOf={colorOf} onOpen={onOpenEvent} />
        ))}
        {layout.moreByDay.map((more, column) => more > 0 ? (
          <Box
            key={days[column]}
            as="button"
            display="flex"
            alignItems="center"
            minW="0"
            px="1.5"
            cursor="pointer"
            textStyle="label"
            color="fg.muted"
            gridColumn={column + 1}
            gridRow={MONTH_MAX_LANES + 2}
            pointerEvents="auto"
            outline="none"
            aria-label={`Show ${more} more ${more === 1 ? "event" : "events"} on ${longDate(days[column])}`}
            onClick={() => onOpenDay(days[column])}
            _hover={{ color: "fg", textDecoration: "underline" }}
            _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "1px" }}
          >
            +{more} more
          </Box>
        ) : null)}
      </Grid>
    </Box>
  );
});

/**
 * The month grid: six weeks starting on Monday, each day with up to three event chips and
 * "+N more", multi-day events as one bar across their days. Clicking the empty part of a day adds
 * an event there (`onAddOnDay`); a day's number and "+N more" open the day (`onOpenDay`); a chip
 * opens its event (`onOpenEvent`). `date` is any date of the month shown.
 */
export function MonthView({
  date,
  today,
  events,
  colorOf,
  onOpenEvent,
  onAddOnDay,
  onOpenDay,
}: {
  date: string;
  today: string;
  events: readonly CalendarEvent[];
  colorOf: ColorOf;
  onOpenEvent: (event: CalendarEvent) => void;
  onAddOnDay: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const weeks = useMemo(() => monthGridWeeks(date), [date]);
  const month = date.slice(0, 7);
  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="card" bg="bg.surface" overflow="hidden" minW="0">
      <Grid templateColumns={COLUMNS} bg="bg.subtle">
        {WEEKDAYS.map((weekday) => (
          <Box key={weekday} textStyle="label" color="fg.muted" px="2" py="1.5" textAlign="start">
            {weekday}
          </Box>
        ))}
      </Grid>
      {weeks.map((days) => (
        <Week
          key={days[0]}
          days={days}
          month={month}
          today={today}
          events={events}
          colorOf={colorOf}
          onOpenEvent={onOpenEvent}
          onAddOnDay={onAddOnDay}
          onOpenDay={onOpenDay}
        />
      ))}
    </Box>
  );
}

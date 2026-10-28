"use client";

import { Box, Flex, Grid, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AttendeeDots, eventAppearance, eventLabel, type ColorOf } from "@/components/family-calendar/event-appearance";
import { EventChip } from "@/components/family-calendar/month-view";
import { isAllDayRowEvent, localTime } from "@/lib/family-calendar/days";
import {
  layoutDayColumns,
  MINUTES_PER_DAY,
  nowPosition,
  slotTimeAt,
  timeOfMinutes,
  VIEW_END_HOUR,
  VIEW_START_HOUR,
  type DayColumnItem,
} from "@/lib/family-calendar/day-layout";
import { layoutMonthWeek } from "@/lib/family-calendar/month-layout";
import { isPendingEvent } from "@/lib/family-calendar/optimistic";
import { DEFAULT_EVENT_TIMEZONE, type CalendarEvent } from "@/lib/family-calendar/types";
import { dayHeading, longDate } from "@/lib/family-calendar/view";

/** Pixels per hour in the grid: a block 30 minutes long is 24 px, enough for a title. */
export const HOUR_PX = 48;

/** The all-day row shows this many lanes of bars before "+N more". */
const ALL_DAY_LANES = 3;

const GUTTER = { base: "2.75rem", md: "3.5rem" };
const gridColumns = (days: number) => ({
  base: `${GUTTER.base} repeat(${days}, minmax(0, 1fr))`,
  md: `${GUTTER.md} repeat(${days}, minmax(0, 1fr))`,
});
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The minute-by-minute clock the "now" line follows: null until the first client render, so the server's markup matches. */
function useNow(enabled: boolean) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/** One timed event in its day column: a block in the member's colour, placed by time, sharing the width with overlapping ones. */
function EventBlock({ item, colorOf, onOpen }: { item: DayColumnItem; colorOf: ColorOf; onOpen: (event: CalendarEvent) => void }) {
  const { event, startMinute, endMinute, column, columns, span } = item;
  const appearance = eventAppearance(event, colorOf);
  const height = ((endMinute - startMinute) / 60) * HOUR_PX - 2;
  // Under about 40 minutes there's one line: the time and the title side by side.
  const short = endMinute - startMinute < 45;
  return (
    <Box
      as="button"
      position="absolute"
      display="flex"
      flexDirection={short ? "row" : "column"}
      alignItems={short ? "center" : "flex-start"}
      gap={short ? "1" : "0"}
      px="1.5"
      py={short ? "0" : "1"}
      overflow="hidden"
      textAlign="start"
      cursor="pointer"
      textStyle="label"
      bg={appearance.bg}
      color={appearance.color}
      borderWidth={appearance.neutral ? "1px" : "0"}
      borderColor="border.strong"
      borderRadius="control"
      opacity={isPendingEvent(event) ? 0.6 : 1}
      style={{
        top: `${(startMinute / 60) * HOUR_PX + 1}px`,
        height: `${height}px`,
        left: `calc(${(column / columns) * 100}% + 1px)`,
        width: `calc(${(span / columns) * 100}% - 2px)`,
      }}
      zIndex="1"
      outline="none"
      aria-label={eventLabel(event)}
      onClick={() => onOpen(event)}
      _hover={{ filter: "brightness(0.95)" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "1px", zIndex: 2 }}
    >
      <Flex align="center" gap="1" minW="0" maxW="full">
        {event.attendees.length > 1 ? <AttendeeDots attendees={event.attendees} colorOf={colorOf} /> : null}
        <Box as="span" fontWeight="medium" minW="0" truncate={short} lineClamp={short ? undefined : Math.max(1, Math.floor(height / 16) - 1)}>
          {event.title}
        </Box>
      </Flex>
      {short && columns > 1 ? null : (
        <Box as="span" fontWeight="normal" opacity={0.85} whiteSpace="nowrap" flexShrink="0">
          {localTime(event.startsAt, event.timezone)}{short ? "" : ` – ${localTime(event.endsAt, event.timezone)}`}
        </Box>
      )}
    </Box>
  );
}

/**
 * The Week view: a header of weekday names, an all-day row (all-day and multi-day events as bars
 * across their days, like the month grid's), and the hourly grid below it. The grid covers the whole
 * day and scrolls; it opens showing 07:00 to 22:00. Timed events sit where their time puts them,
 * overlapping ones side by side (`layoutDayColumns`), and a line marks the time now in today's column.
 *
 * `days` are the dates shown: seven from Monday, or three on a phone. Clicking the empty part of a
 * day column adds an event at that hour (`onAddAt` with the hour), and the empty part of the all-day
 * row adds an all-day event (`onAddAt` with no time). A day's name opens the day (`onOpenDay`).
 */
export function WeekView({
  days,
  today,
  events,
  colorOf,
  onOpenEvent,
  onAddAt,
  onOpenDay,
}: {
  days: readonly string[];
  today: string;
  events: readonly CalendarEvent[];
  colorOf: ColorOf;
  onOpenEvent: (event: CalendarEvent) => void;
  onAddAt: (date: string, startTime?: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // The grid's scrollbar takes width the header doesn't have; the header pads by the same amount to stay in line.
  const [scrollbar, setScrollbar] = useState(0);
  const showsToday = days.includes(today);
  const now = useNow(showsToday);
  const clock = now ? nowPosition(now, DEFAULT_EVENT_TIMEZONE) : null;

  const allDay = useMemo(() => layoutMonthWeek(events.filter(isAllDayRowEvent), days[0], ALL_DAY_LANES, days.length), [events, days]);
  const columns = useMemo(() => days.map((date) => ({ date, items: layoutDayColumns(events, date) })), [events, days]);
  const hasMore = allDay.moreByDay.some((more) => more > 0);
  const rows = Math.max(1, allDay.laneCount) + (hasMore ? 1 : 0);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return undefined;
    // A few pixels above 07:00, so its label isn't cut off.
    element.scrollTop = VIEW_START_HOUR * HOUR_PX - 8;
    const measure = () => setScrollbar(element.offsetWidth - element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const templateColumns = gridColumns(days.length);
  const dayColumns = `repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="card" bg="bg.surface" overflow="hidden" minW="0">
      <Box pe={`${scrollbar}px`} borderBottomWidth="1px" borderColor="border" bg="bg.subtle">
        <Grid templateColumns={templateColumns}>
          <Box />
          {days.map((date) => {
            const isToday = date === today;
            const [weekday, day] = dayHeading(date).split(" ");
            return (
              <Flex key={date} justify="center" py="1.5" borderInlineStartWidth="1px" borderColor="border" minW="0">
                <Box
                  as="button"
                  display="inline-flex"
                  alignItems="center"
                  gap="1.5"
                  px="1.5"
                  borderRadius="control"
                  cursor="pointer"
                  textStyle="label"
                  color={isToday ? "fg.accent" : "fg.muted"}
                  outline="none"
                  aria-label={`Show ${longDate(date)}${isToday ? " (today)" : ""}`}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => onOpenDay(date)}
                  _hover={{ bg: "bg.emphasized" }}
                  _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "1px" }}
                >
                  {weekday}
                  <Box
                    as="span"
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    h="6"
                    minW="6"
                    borderRadius="full"
                    fontWeight="semibold"
                    bg={isToday ? "brand.solid" : "transparent"}
                    color={isToday ? "brand.contrast" : "fg"}
                  >
                    {day}
                  </Box>
                </Box>
              </Flex>
            );
          })}
        </Grid>
        <Grid templateColumns={templateColumns} borderTopWidth="1px" borderColor="border" bg="bg.surface">
          <Flex align="center" justify="center" px="1" textStyle="caption" color="fg.muted" aria-hidden="true">All day</Flex>
          <Box position="relative" gridColumn={`2 / span ${days.length}`}>
            <Grid position="absolute" inset="0" templateColumns={dayColumns}>
              {days.map((date, column) => (
                <Box
                  key={date}
                  as="button"
                  // Adding on a day is a mouse shortcut; the Add event button is the keyboard route.
                  tabIndex={-1}
                  aria-label={`Add an all-day event on ${longDate(date)}`}
                  cursor="pointer"
                  borderInlineStartWidth="1px"
                  borderColor="border"
                  bg={date === today ? "bg.selected" : "bg.surface"}
                  _hover={{ bg: date === today ? "bg.selected" : "bg.muted" }}
                  onClick={() => onAddAt(date)}
                  data-column={column}
                />
              ))}
            </Grid>
            <Grid
              position="relative"
              templateColumns={dayColumns}
              templateRows={`repeat(${rows}, 1.375rem)`}
              minH="1.75rem"
              py="0.5"
              pointerEvents="none"
              alignContent="center"
            >
              {allDay.segments.map((segment) => (
                <EventChip key={`${segment.event.id}-${segment.column}`} segment={segment} colorOf={colorOf} onOpen={onOpenEvent} firstRow={1} />
              ))}
              {allDay.moreByDay.map((more, column) => more > 0 ? (
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
                  gridRow={rows}
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
        </Grid>
      </Box>

      <Box
        ref={scroller}
        overflowY="auto"
        // Shows 07:00 to 22:00 and scrolls to the rest; a phone, being short, shows what its screen allows.
        h={`${(VIEW_END_HOUR - VIEW_START_HOUR) * HOUR_PX}px`}
        maxH={{ base: "65dvh", md: "none" }}
        overscrollBehavior="contain"
        data-testid="week-grid"
      >
        <Grid templateColumns={templateColumns} position="relative" style={{ height: `${24 * HOUR_PX}px` }}>
          <Box position="relative" aria-hidden="true">
            {HOURS.slice(1).map((hour) => (
              <Text
                key={hour}
                position="absolute"
                insetInlineEnd="1.5"
                textStyle="caption"
                lineHeight="1"
                style={{ top: `${hour * HOUR_PX - 5}px` }}
              >
                {timeOfMinutes(hour * 60)}
              </Text>
            ))}
          </Box>
          {columns.map(({ date, items }) => {
            const isToday = date === today;
            const nowMinute = clock && clock.date === date ? clock.minute : null;
            return (
              <Box key={date} position="relative" borderInlineStartWidth="1px" borderColor="border" bg={isToday ? "bg.selected" : undefined} minW="0">
                <Box
                  as="button"
                  position="absolute"
                  inset="0"
                  w="full"
                  cursor="pointer"
                  // Adding at an hour is a mouse shortcut; the Add event button is the keyboard route.
                  tabIndex={-1}
                  aria-label={`Add an event on ${longDate(date)}`}
                  onClick={(click) => onAddAt(date, slotTimeAt(click.clientY - click.currentTarget.getBoundingClientRect().top, HOUR_PX))}
                  _hover={{ bg: isToday ? "transparent" : "bg.subtle" }}
                />
                {HOURS.slice(1).map((hour) => (
                  <Box key={hour} position="absolute" insetInline="0" borderTopWidth="1px" borderColor="border" aria-hidden="true" pointerEvents="none" style={{ top: `${hour * HOUR_PX}px` }} />
                ))}
                {items.map((item) => (
                  <EventBlock key={item.event.id} item={item} colorOf={colorOf} onOpen={onOpenEvent} />
                ))}
                {nowMinute !== null ? (
                  <Box
                    position="absolute"
                    insetInline="0"
                    zIndex="2"
                    pointerEvents="none"
                    aria-hidden="true"
                    data-testid="now-line"
                    style={{ top: `${(nowMinute / MINUTES_PER_DAY) * 24 * HOUR_PX - 1}px` }}
                    borderTopWidth="2px"
                    borderColor="danger.solid"
                  >
                    <Box position="absolute" boxSize="2.5" borderRadius="full" bg="danger.solid" style={{ top: "-6px", insetInlineStart: "-5px" }} />
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Grid>
      </Box>
    </Box>
  );
}

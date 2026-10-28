"use client";

import { Box, Button, Flex, Grid, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { eventDotColor, type ColorOf } from "@/components/family-calendar/event-appearance";
import { EventRow } from "@/components/family-calendar/event-row";
import { Card } from "@/components/ui/card";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { eventsOnDay } from "@/lib/family-calendar/days";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import { longDate, monthGridWeeks } from "@/lib/family-calendar/view";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** How many dots a day shows before it stops counting. */
export const MONTH_MAX_DOTS = 3;

/**
 * The dots for the events on `dayEvents`: one per event in its colour (the member's, or neutral for
 * several people), at most `max`. `more` is how many events had no dot.
 */
export function dayDots(dayEvents: readonly CalendarEvent[], colorOf: ColorOf, max = MONTH_MAX_DOTS) {
  return { colors: dayEvents.slice(0, max).map((event) => eventDotColor(event, colorOf)), more: Math.max(0, dayEvents.length - max) };
}

/**
 * The phone's month: the six-week grid with a few colour dots under each day's number instead of
 * chips. Tapping a day chooses it (`onSelectDay`); `selected` is the chosen day, which is also the
 * month shown, and the events under the grid are its (`SelectedDay`).
 */
export function MonthDots({
  selected,
  today,
  events,
  colorOf,
  onSelectDay,
}: {
  selected: string;
  today: string;
  events: readonly CalendarEvent[];
  colorOf: ColorOf;
  onSelectDay: (date: string) => void;
}) {
  const weeks = useMemo(() => monthGridWeeks(selected), [selected]);
  const month = selected.slice(0, 7);
  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="card" bg="bg.surface" overflow="hidden" minW="0">
      <Grid templateColumns="repeat(7, minmax(0, 1fr))" bg="bg.subtle" aria-hidden="true">
        {WEEKDAYS.map((weekday, index) => (
          <Box key={WEEKDAY_NAMES[index]} textStyle="label" color="fg.muted" py="1.5" textAlign="center">{weekday}</Box>
        ))}
      </Grid>
      {weeks.map((days) => (
        <Grid key={days[0]} templateColumns="repeat(7, minmax(0, 1fr))" borderTopWidth="1px" borderColor="border">
          {days.map((date) => {
            const dayEvents = eventsOnDay(events, date);
            const dots = dayDots(dayEvents, colorOf);
            const isToday = date === today;
            const isSelected = date === selected;
            const inMonth = date.slice(0, 7) === month;
            const count = dayEvents.length;
            return (
              <Box
                key={date}
                as="button"
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="flex-start"
                gap="1"
                h="3.25rem"
                pt="1.5"
                minW="0"
                cursor="pointer"
                bg={isSelected ? "bg.selected" : inMonth ? "bg.surface" : "bg.subtle"}
                outline="none"
                aria-label={`${longDate(date)}${isToday ? " (today)" : ""}, ${count === 0 ? "no events" : `${count} ${count === 1 ? "event" : "events"}`}`}
                aria-pressed={isSelected}
                aria-current={isToday ? "date" : undefined}
                onClick={() => onSelectDay(date)}
                _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "-2px" }}
              >
                <Box
                  as="span"
                  display="inline-flex"
                  alignItems="center"
                  justifyContent="center"
                  h="6"
                  minW="6"
                  borderRadius="full"
                  textStyle="label"
                  fontWeight={isToday || isSelected ? "semibold" : "medium"}
                  bg={isToday ? "brand.solid" : "transparent"}
                  color={isToday ? "brand.contrast" : inMonth ? "fg" : "fg.subtle"}
                  borderWidth="2px"
                  borderColor={isSelected ? "brand.solid" : "transparent"}
                >
                  {Number(date.slice(8))}
                </Box>
                <Flex gap="0.5" h="1.5" align="center" aria-hidden="true">
                  {dots.colors.map((color, index) => (
                    <Box key={index} boxSize="1.5" borderRadius="full" bg={color} />
                  ))}
                  {dots.more > 0 ? <Box as="span" textStyle="caption" lineHeight="1">+</Box> : null}
                </Flex>
              </Box>
            );
          })}
        </Grid>
      ))}
    </Box>
  );
}

/**
 * The chosen day's events below the phone's month grid: its date, the events in full (the same rows as the
 * Agenda), and a button to add one on that day.
 */
export function SelectedDay({
  date,
  events,
  colorOf,
  onOpenEvent,
  onAdd,
}: {
  date: string;
  /** The events covering `date`, in order. */
  events: readonly CalendarEvent[];
  colorOf: ColorOf;
  onOpenEvent: (event: CalendarEvent) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <Card>
      <Card.Body>
        <Flex align="center" justify="space-between" gap="3" mb="3">
          <Box minW="0">
            <Text as="h3" textStyle="sectionTitle">{longDate(date)}</Text>
            <Text textStyle="caption">{events.length === 0 ? "Nothing planned." : `${events.length} ${events.length === 1 ? "event" : "events"}`}</Text>
          </Box>
          <Button size="sm" variant="outline" flexShrink="0" onClick={() => onAdd(date)}>
            <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add
          </Button>
        </Flex>
        <Flex direction="column" gap="1.5">
          {events.map((event) => (
            <EventRow key={event.id} event={event} date={date} colorOf={colorOf} onOpen={onOpenEvent} />
          ))}
        </Flex>
      </Card.Body>
    </Card>
  );
}

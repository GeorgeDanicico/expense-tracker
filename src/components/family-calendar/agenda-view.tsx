"use client";

import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { CalendarPlus, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import type { ColorOf } from "@/components/family-calendar/event-appearance";
import { EventRow } from "@/components/family-calendar/event-row";
import { useCalendarRange } from "@/components/family-calendar/use-calendar-events";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { addDays } from "@/lib/calendar";
import { datesFrom, groupEventsByDay } from "@/lib/family-calendar/days";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import { AGENDA_DAYS, AGENDA_MORE_DAYS, dayHeading, longDate } from "@/lib/family-calendar/view";

type AgendaProps = {
  today: string;
  colorOf: ColorOf;
  member?: string | null;
  onOpenEvent: (event: CalendarEvent) => void;
  onAddOnDay: (date: string) => void;
};

/** A day's heading column: weekday and number, the number filled for today. */
function DayHeading({ date, today }: { date: string; today: string }) {
  const [weekday, day, month] = dayHeading(date).split(" ");
  const isToday = date === today;
  return (
    <Box w={{ base: "3.5rem", sm: "5rem" }} flexShrink="0" pt="1">
      <Text textStyle="label" color={isToday ? "fg.accent" : "fg.muted"}>{weekday}{isToday ? " · Today" : ""}</Text>
      <Flex align="baseline" gap="1">
        <Text textStyle="sectionTitle" color={isToday ? "fg.accent" : "fg"}>{day}</Text>
        <Text textStyle="caption">{month}</Text>
      </Flex>
    </Box>
  );
}

/**
 * One stretch of the Agenda: `days` days from `start`, fetched as one range. The first stretch is the
 * Agenda's 60 days; "Load more" at its end opens the next 30 days as another stretch, and so on, each
 * its own request (a range holds at most 92 days). Days without events are left out.
 */
function AgendaChunk({
  start,
  days,
  first,
  today,
  colorOf,
  member,
  onOpenEvent,
  onAddOnDay,
}: AgendaProps & { start: string; days: number; first: boolean }) {
  const range = useMemo(() => ({ start, endExclusive: addDays(start, days) }), [start, days]);
  const { events, error, refresh } = useCalendarRange(range, { member });
  const [more, setMore] = useState(false);
  const groups = useMemo(
    () => groupEventsByDay(events ?? [], datesFrom(start, days)).filter((group) => group.events.length > 0),
    [events, start, days],
  );
  const last = addDays(range.endExclusive, -1);

  if (!events) {
    return error
      ? <DataError message="The calendar could not be loaded." retry={refresh} />
      : <DataLoading layout="section" label="Loading the agenda…" />;
  }

  return (
    <Stack gap="3">
      {groups.length === 0 ? (
        first ? (
          <Card>
            <Card.Body>
              <EmptyState
                size="sm"
                titleAs="h2"
                icon={<CalendarPlus />}
                title="Nothing planned"
                description={`No events from ${longDate(start)} to ${longDate(last)}.`}
                action={(
                  <Button size="sm" variant="solid" colorPalette="brand" onClick={() => onAddOnDay(start)}>
                    Add an event
                  </Button>
                )}
              />
            </Card.Body>
          </Card>
        ) : (
          <Text textStyle="caption" textAlign="center">No events from {longDate(start)} to {longDate(last)}.</Text>
        )
      ) : (
        <Card>
          <Card.Body>
            <Stack gap="0" as="ol" m="0" p="0" listStyleType="none">
              {groups.map((group, index) => (
                <Flex
                  as="li"
                  key={group.date}
                  gap={{ base: "3", sm: "4" }}
                  py="3"
                  borderTopWidth={index === 0 ? "0" : "1px"}
                  borderColor="border"
                  aria-label={longDate(group.date)}
                >
                  <DayHeading date={group.date} today={today} />
                  <Stack gap="1.5" flex="1" minW="0">
                    {group.events.map((event) => (
                      <EventRow key={event.id} event={event} date={group.date} colorOf={colorOf} onOpen={onOpenEvent} />
                    ))}
                  </Stack>
                </Flex>
              ))}
            </Stack>
          </Card.Body>
        </Card>
      )}
      {more ? (
        <AgendaChunk
          start={range.endExclusive}
          days={AGENDA_MORE_DAYS}
          first={false}
          today={today}
          colorOf={colorOf}
          member={member}
          onOpenEvent={onOpenEvent}
          onAddOnDay={onAddOnDay}
        />
      ) : (
        <Flex justify="center" align="center" gap="3" wrap="wrap">
          <Text textStyle="caption">Showing events until {longDate(last)}.</Text>
          <Button variant="outline" size="sm" onClick={() => setMore(true)}>
            <ChevronDown size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
            Load more
          </Button>
        </Flex>
      )}
    </Stack>
  );
}

/** The Agenda: the next 60 days from `start`, grouped by day, with "Load more" for 30 days at a time. */
export function AgendaView({ start, ...props }: AgendaProps & { start: string }) {
  return <AgendaChunk key={start} start={start} days={AGENDA_DAYS} first {...props} />;
}

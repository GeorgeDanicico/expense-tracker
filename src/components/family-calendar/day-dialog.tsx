"use client";

import { Button, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import type { ColorOf } from "@/components/family-calendar/event-appearance";
import { EventRow } from "@/components/family-calendar/event-row";
import { AppDialog } from "@/components/ui/app-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import { longDate } from "@/lib/family-calendar/view";

/**
 * One day's events in full (what "+2 more" and a day's number open in the month grid), each
 * opening its event, with a button to add one on that day.
 */
export function DayDialog({
  date,
  events,
  colorOf,
  open,
  onOpenChange,
  onOpenEvent,
  onAdd,
}: {
  date: string;
  /** The events covering `date`, in order. */
  events: readonly CalendarEvent[];
  colorOf: ColorOf;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={longDate(date)}
      description={events.length === 0 ? "Nothing planned." : `${events.length} ${events.length === 1 ? "event" : "events"}`}
      footer={(
        <Button variant="solid" colorPalette="brand" size={{ base: "md", sm: "sm" }} onClick={() => onAdd(date)}>
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add event
        </Button>
      )}
    >
      {events.length === 0 ? (
        <Text textStyle="bodySm" color="fg.muted">Add the first event on this day.</Text>
      ) : (
        <Stack gap="1.5">
          {events.map((event) => (
            <EventRow key={event.id} event={event} date={date} colorOf={colorOf} onOpen={onOpenEvent} />
          ))}
        </Stack>
      )}
    </AppDialog>
  );
}

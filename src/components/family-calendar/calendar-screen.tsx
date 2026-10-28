"use client";

import { Button, Flex, Heading, Stack } from "@chakra-ui/react";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { AgendaView } from "@/components/family-calendar/agenda-view";
import { DayDialog } from "@/components/family-calendar/day-dialog";
import { EventDialog, type EventDialogMode } from "@/components/family-calendar/event-dialog";
import { MonthView } from "@/components/family-calendar/month-view";
import { useCalendarRange, useCalendarWrites, usePrefetchRanges } from "@/components/family-calendar/use-calendar-events";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAccount } from "@/hooks/use-account";
import { useMemberColors } from "@/hooks/use-member-colors";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import { getBucharestToday } from "@/lib/calendar";
import { eventsOnDay } from "@/lib/family-calendar/days";
import { isPendingEvent } from "@/lib/family-calendar/optimistic";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import {
  CALENDAR_VIEW_LABELS,
  CALENDAR_VIEWS,
  calendarHref,
  neighbourRanges,
  parseCalendarParams,
  periodTitle,
  shiftCalendarDate,
  viewRange,
  type CalendarState,
  type CalendarView,
} from "@/lib/family-calendar/view";

/** Shown to a user without a family, who has no calendar. */
export function NoFamilyCalendar() {
  return (
    <EmptyState
      icon={<CalendarDays size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
      title="The calendar belongs to a family"
      titleAs="h2"
      description="Create a family or join one, and everyone in it shares one calendar."
      action={(
        <Button asChild size="sm" variant="solid" colorPalette="brand">
          <Link href="/settings/family">Go to Settings → Family</Link>
        </Button>
      )}
    />
  );
}

/** The Week view's place until it is built (family C6). */
export function WeekPlaceholder({ onShow }: { onShow: (view: CalendarView) => void }) {
  return (
    <Card>
      <Card.Body>
        <EmptyState
          size="sm"
          titleAs="h2"
          icon={<CalendarRange size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
          title="The week view is coming soon"
          description="Until then, the month and the agenda show every event."
          action={(
            <Flex gap="2" wrap="wrap" justify="center">
              <Button size="sm" variant="outline" onClick={() => onShow("month")}>Show the month</Button>
              <Button size="sm" variant="outline" onClick={() => onShow("agenda")}>Show the agenda</Button>
            </Flex>
          )}
        />
      </Card.Body>
    </Card>
  );
}

/** What is open on top of the calendar. */
type Dialog =
  | { kind: "event"; mode: EventDialogMode; id: string }
  | { kind: "day"; date: string }
  | null;

const PERIOD_NAMES: Record<CalendarView, string> = { month: "month", week: "week", agenda: "60 days" };

/**
 * The family calendar page: header (Today, previous and next, the period's title, the view
 * switcher; its state is in the URL as `?view=` and `?date=`), the chosen view, and the event
 * dialogs. Needs a Suspense boundary above it for `useSearchParams`.
 *
 * Month and Agenda are drawn here; Week is a placeholder until C6, which also adds the member
 * filter chips above the view (their `?member=` value goes to `useCalendarRange`/`rangeKey`).
 */
export function CalendarScreen() {
  const { account } = useAccount();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const colorOf = useMemberColors();
  const today = getBucharestToday();
  const { view, date } = parseCalendarParams(searchParams, today);
  const hasFamily = Boolean(account?.membership);
  const myMemberId = account?.membership?.memberId ?? null;
  const { data: family } = useSWR<FamilyResponse>(hasFamily ? FAMILY_API_KEY : null);
  const members = useMemo(() => family?.family?.members ?? [], [family]);

  const range = useMemo(() => viewRange(view, date), [view, date]);
  const neighbours = useMemo(() => neighbourRanges(view, date), [view, date]);
  const current = useCalendarRange(range, { enabled: hasFamily });
  usePrefetchRanges(neighbours, { enabled: hasFamily });
  const writes = useCalendarWrites(members);
  const [dialog, setDialog] = useState<Dialog>(null);

  // The native History API syncs `useSearchParams` without a server round trip, and pushing
  // (unlike the to-do filters) keeps each month in the back button's history.
  const go = (next: Partial<CalendarState>) => {
    const href = calendarHref(pathname, searchParams, { view, date, ...next }, today);
    window.history.pushState(null, "", href);
  };
  const step = (direction: -1 | 1) => go({ date: shiftCalendarDate(view, date, direction) });

  const header = (
    <PageHeader
      title="Calendar"
      description={account?.membership?.familyName ? `Shared by everyone in ${account.membership.familyName}` : undefined}
      actions={hasFamily ? (
        <Button size="sm" variant="solid" colorPalette="brand" onClick={() => openCreate(range.start <= today && today < range.endExclusive ? today : date)}>
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add event
        </Button>
      ) : undefined}
    />
  );

  function openCreate(onDate: string) {
    setDialog({ kind: "event", mode: { kind: "create", date: onDate }, id: `new-${onDate}-${Date.now()}` });
  }
  function openEvent(event: CalendarEvent) {
    // A guess the server hasn't confirmed has no id to edit yet.
    if (isPendingEvent(event)) return;
    setDialog({ kind: "event", mode: { kind: "edit", event }, id: event.id });
  }

  if (!account) {
    return (
      <Stack gap={{ base: "4", md: "5" }}>
        {header}
        <DataLoading label="Loading the calendar…" />
      </Stack>
    );
  }
  if (!hasFamily || current.noFamily) {
    return (
      <Stack gap={{ base: "4", md: "5" }}>
        {header}
        <NoFamilyCalendar />
      </Stack>
    );
  }

  const events = current.events ?? [];
  const failed = view !== "agenda" && current.error && !current.events;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      {header}
      <Flex align="center" justify="space-between" gap="3" wrap="wrap">
        <Flex align="center" gap="2" wrap="wrap" minW="0">
          <Button variant="outline" size="sm" onClick={() => go({ date: today })}>Today</Button>
          <Flex gap="1">
            <IconButton aria-label={`Previous ${PERIOD_NAMES[view]}`} variant="outline" onClick={() => step(-1)}>
              <ChevronLeft size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={`Next ${PERIOD_NAMES[view]}`} variant="outline" onClick={() => step(1)}>
              <ChevronRight size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </IconButton>
          </Flex>
          <Heading as="h2" size="lg" aria-live="polite" minW="0">{periodTitle(view, date, today)}</Heading>
        </Flex>
        <SegmentedControl
          aria-label="Calendar view"
          value={view}
          onValueChange={(next) => go({ view: next })}
          items={CALENDAR_VIEWS.map((value) => ({ value, label: CALENDAR_VIEW_LABELS[value] }))}
        />
      </Flex>
      {view !== "agenda" ? (
        <DataRefresh error={current.events ? current.error : undefined} updating={current.isLoading} retry={current.refresh} />
      ) : null}

      {failed ? (
        <DataError message="The calendar could not be loaded." retry={current.refresh} />
      ) : view === "month" ? (
        <MonthView
          date={date}
          today={today}
          events={events}
          colorOf={colorOf}
          onOpenEvent={openEvent}
          onAddOnDay={openCreate}
          onOpenDay={(day) => setDialog({ kind: "day", date: day })}
        />
      ) : view === "week" ? (
        <WeekPlaceholder onShow={(next) => go({ view: next })} />
      ) : (
        <AgendaView start={date} today={today} colorOf={colorOf} onOpenEvent={openEvent} onAddOnDay={openCreate} />
      )}

      {dialog?.kind === "event" ? (
        <EventDialog
          key={dialog.id}
          mode={dialog.mode}
          members={members}
          myMemberId={myMemberId}
          colorOf={colorOf}
          open
          onOpenChange={(open) => { if (!open) setDialog(null); }}
          onCreate={writes.create}
          onUpdate={writes.update}
          onRemove={writes.remove}
        />
      ) : null}
      {dialog?.kind === "day" ? (
        <DayDialog
          date={dialog.date}
          events={eventsOnDay(events, dialog.date)}
          colorOf={colorOf}
          open
          onOpenChange={(open) => { if (!open) setDialog(null); }}
          onOpenEvent={openEvent}
          onAdd={openCreate}
        />
      ) : null}
    </Stack>
  );
}

"use client";

import { Button, Flex, Heading, Stack } from "@chakra-ui/react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { AgendaView } from "@/components/family-calendar/agenda-view";
import { useCalendarApi } from "@/components/family-calendar/calendar-api";
import { DayDialog } from "@/components/family-calendar/day-dialog";
import { EventDialog, type EventDialogMode } from "@/components/family-calendar/event-dialog";
import { MemberChips } from "@/components/family-calendar/member-chips";
import { MonthDots, SelectedDay } from "@/components/family-calendar/month-dots";
import { MonthView } from "@/components/family-calendar/month-view";
import { useCalendarRange, useCalendarWrites, usePrefetchRanges } from "@/components/family-calendar/use-calendar-events";
import { WeekView } from "@/components/family-calendar/week-view";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAccount } from "@/hooks/use-account";
import { useIsPhone } from "@/hooks/use-is-phone";
import { useMemberColors } from "@/hooks/use-member-colors";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import { getBucharestToday } from "@/lib/calendar";
import { eventsOnDay } from "@/lib/family-calendar/days";
import {
  attendeesForNewEvent,
  memberFilterHref,
  memberIdFor,
  parseMemberFilter,
  type CalendarMemberFilter,
} from "@/lib/family-calendar/filters";
import {
  CALENDAR_EVENT_PARAM,
  LINKED_EVENT_MISSING_MESSAGE,
  linkedEventHref,
  loadLinkedEvent,
  withoutEventHref,
} from "@/lib/family-calendar/linked-event";
import { isPendingEvent } from "@/lib/family-calendar/optimistic";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import {
  AGENDA_DAYS,
  CALENDAR_VIEW_LABELS,
  CALENDAR_VIEWS,
  calendarHref,
  defaultViewFor,
  neighbourRanges,
  parseCalendarParams,
  periodTitle,
  shiftCalendarDate,
  viewRange,
  weekLengthFor,
  weekViewDays,
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

/** What is open on top of the calendar. */
type Dialog =
  | { kind: "event"; mode: EventDialogMode; id: string }
  | { kind: "day"; date: string }
  | null;

/** What Previous and Next move by, for their labels. */
function periodName(view: CalendarView, phone: boolean) {
  return view === "week" ? (phone ? "3 days" : "week") : view === "month" ? "month" : `${AGENDA_DAYS} days`;
}

/**
 * The family calendar page: the member chips, the header (Today, previous and next, the period's
 * title, the view switcher), the chosen view, and the event dialogs. Its state is in the URL:
 * `?view=` and `?date=`, and `?member=` for the chips (Everyone leaves it out; `me` and a member
 * id are passed to the API as `member`, for the views and the prefetches alike). Needs a Suspense
 * boundary above it for `useSearchParams`.
 *
 * Phones (below 768 px) open on the Agenda when the URL has no `?view=`; Month there shows dots
 * and lists the chosen day (`?date=`) below the grid, and Week shows three days from `?date=`.
 */
export function CalendarScreen() {
  const { account } = useAccount();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const colorOf = useMemberColors();
  const phone = useIsPhone();
  const today = getBucharestToday();
  const defaultView = defaultViewFor(phone);
  const weekLength = weekLengthFor(phone);
  const { view, date } = parseCalendarParams(searchParams, today, defaultView);
  const hasFamily = Boolean(account?.membership);
  const myMemberId = account?.membership?.memberId ?? null;
  const { data: family } = useSWR<FamilyResponse>(hasFamily ? FAMILY_API_KEY : null);
  const members = useMemo(() => family?.family?.members ?? [], [family]);
  const memberIds = family ? members.map((member) => member.memberId) : undefined;
  // A `?member=` naming nobody in the family is Everyone once the family has loaded.
  const filter = parseMemberFilter(searchParams, memberIds);
  const filteredMemberId = memberIdFor(filter, myMemberId);

  const range = useMemo(() => viewRange(view, date, undefined, weekLength), [view, date, weekLength]);
  const neighbours = useMemo(() => neighbourRanges(view, date, weekLength), [view, date, weekLength]);
  const current = useCalendarRange(range, { enabled: hasFamily, member: filteredMemberId });
  usePrefetchRanges(neighbours, { enabled: hasFamily, member: filteredMemberId });
  const writes = useCalendarWrites(members);
  const [dialog, setDialog] = useState<Dialog>(null);

  // `?event=<id>` (where an event notification leads) opens that event: fetch it, move the view to
  // its day and open its form, then drop the parameter so a reload or the next notification starts
  // afresh. An event that can't be had (deleted, not the family's) says so instead. Each id is acted
  // on once, whatever refetches or re-renders follow.
  const api = useCalendarApi();
  const eventParam = searchParams.get(CALENDAR_EVENT_PARAM)?.trim() || null;
  const handledEvent = useRef<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!eventParam || !hasFamily || handledEvent.current === eventParam) return;
    handledEvent.current = eventParam;
    void loadLinkedEvent(eventParam, (id) => api.get(id)).then((event) => {
      if (!event) {
        window.history.replaceState(null, "", withoutEventHref(pathname, window.location.search));
        setLinkNotice(LINKED_EVENT_MISSING_MESSAGE);
        return;
      }
      window.history.replaceState(null, "", linkedEventHref(pathname, window.location.search, event, getBucharestToday(), defaultView));
      setLinkNotice(null);
      setDialog({ kind: "event", mode: { kind: "edit", event }, id: event.id });
    });
  }, [eventParam, hasFamily, api, pathname, defaultView]);

  // The native History API syncs `useSearchParams` without a server round trip. Pushing (unlike the
  // to-do filters) keeps each month in the back button's history; picking a day on a phone, or a
  // chip, replaces instead.
  const go = (next: Partial<CalendarState>, { replace = false }: { replace?: boolean } = {}) => {
    const href = calendarHref(pathname, searchParams, { view, date, ...next }, today, defaultView);
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  };
  const step = (direction: -1 | 1) => go({ date: shiftCalendarDate(view, date, direction, weekLength) });
  const setFilter = (next: CalendarMemberFilter) => window.history.replaceState(null, "", memberFilterHref(pathname, searchParams, next));

  const visibleDays = view === "week" ? weekViewDays(date, weekLength) : null;
  const header = (
    <PageHeader
      title="Calendar"
      description={account?.membership?.familyName ? `Shared by everyone in ${account.membership.familyName}` : undefined}
      actions={hasFamily ? (
        <Button
          size="sm"
          variant="solid"
          colorPalette="brand"
          onClick={() => openCreate(range.start <= today && today < range.endExclusive ? today : date)}
        >
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add event
        </Button>
      ) : undefined}
    />
  );

  /** Opens the form for a new event; under a member's chip it starts with that member going. */
  function openCreate(onDate: string, slot: { startTime?: string; allDay?: boolean } = {}) {
    const mode: EventDialogMode = { kind: "create", date: onDate, ...slot, attendeeMemberIds: attendeesForNewEvent(filter, myMemberId) };
    setDialog({ kind: "event", mode, id: `new-${onDate}-${slot.startTime ?? (slot.allDay ? "all-day" : "")}-${Date.now()}` });
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
      {linkNotice ? (
        <InlineAlert
          title="Event not found"
          action={<Button size="xs" variant="ghost" onClick={() => setLinkNotice(null)}>Dismiss</Button>}
        >
          {linkNotice}
        </InlineAlert>
      ) : null}
      <MemberChips
        filter={filter}
        members={members}
        myMemberId={myMemberId}
        myAvatarUrl={account.avatarUrl}
        colorOf={colorOf}
        onChange={setFilter}
      />
      <Flex align="center" justify="space-between" gap="3" wrap="wrap">
        <Flex align="center" gap="2" wrap="wrap" minW="0">
          <Button variant="outline" size="sm" onClick={() => go({ date: today })}>Today</Button>
          <Flex gap="1">
            <IconButton aria-label={`Previous ${periodName(view, phone)}`} variant="outline" onClick={() => step(-1)}>
              <ChevronLeft size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </IconButton>
            <IconButton aria-label={`Next ${periodName(view, phone)}`} variant="outline" onClick={() => step(1)}>
              <ChevronRight size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </IconButton>
          </Flex>
          <Heading as="h2" size="lg" aria-live="polite" minW="0">{periodTitle(view, date, today, undefined, weekLength)}</Heading>
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
      ) : view === "month" && phone ? (
        <>
          <MonthDots selected={date} today={today} events={events} colorOf={colorOf} onSelectDay={(day) => go({ date: day }, { replace: true })} />
          <SelectedDay date={date} events={eventsOnDay(events, date)} colorOf={colorOf} onOpenEvent={openEvent} onAdd={(day) => openCreate(day)} />
        </>
      ) : view === "month" ? (
        <MonthView
          date={date}
          today={today}
          events={events}
          colorOf={colorOf}
          onOpenEvent={openEvent}
          onAddOnDay={(day) => openCreate(day)}
          onOpenDay={(day) => setDialog({ kind: "day", date: day })}
        />
      ) : visibleDays ? (
        <WeekView
          days={visibleDays}
          today={today}
          events={events}
          colorOf={colorOf}
          onOpenEvent={openEvent}
          onAddAt={(day, startTime) => openCreate(day, startTime ? { startTime } : { allDay: true })}
          onOpenDay={(day) => setDialog({ kind: "day", date: day })}
        />
      ) : (
        <AgendaView start={date} today={today} colorOf={colorOf} member={filteredMemberId} onOpenEvent={openEvent} onAddOnDay={(day) => openCreate(day)} />
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
          onAdd={(day) => openCreate(day)}
        />
      ) : null}
    </Stack>
  );
}

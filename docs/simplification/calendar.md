# Simpler ways: calendar

Looked at `src/components/family-calendar/**` (14 files, ~2,900 lines without tests), `src/app/(app)/calendar`, `src/app/api/calendar/**`, `src/lib/family-calendar/**` (~2,100 lines), `src/lib/validation/calendar-event.ts`, `src/lib/mcp/tools/calendar.ts` and the calendar preview fixture, with the `find-shapes` script and by reading the screen, the three views, the event dialog and the subscribe dialog. **The calendar already uses the target data style** (`calendar-api.tsx` + `use-calendar-events.ts`, optimistic, previewable). 5 proposals, about 45 lines here; the shared family helpers are written up in the to-dos report and only referenced here. The one that is the calendar's own is **the subscribe dialog's hand-rolled load** (proposal 1), which the plan already gives to U10.

## Map

| File | Lines | Role |
| --- | --- | --- |
| `calendar-screen.tsx` | 321 | Header (Subscribe, Add event), member chips, Today / previous / next, Month / Week / Agenda, the dialogs. |
| `month-view.tsx`, `week-view.tsx`, `agenda-view.tsx`, `month-dots.tsx`, `day-dialog.tsx` | 58–336 | The views. On a phone the screen opens on Agenda (60 days); Week shows 3 days. |
| `event-dialog.tsx`, `scope-dialog.tsx`, `subscribe-dialog.tsx` | 449, 91, 259 | Add and edit (title, all day, start and end, who's going, repeat, location, notes), "this or all" for a series, the feed link. |
| `use-calendar-events.ts`, `calendar-api.tsx` | 114, 70 | Ranged SWR reads with prefetch, optimistic writes. |
| `src/lib/family-calendar/*` | ~2,100 | Layout, series, ICS, notifications; pure and tested. |

Counts: `Chip` identical in `event-dialog.tsx:76`, `member-chips.tsx:16` (and `todo-filters.tsx:16`); `memberLabel` / `memberName` in `member-chips.tsx:12` and `event-dialog.tsx:58`; `NoFamilyCalendar` and the board's `NoFamilyBoard`; `useSWR<FamilyResponse>` in `calendar-screen.tsx:116`; `useNow` in `week-view.tsx:38`; `daysBetween` in `series.ts:49`; 1 hand-written route context type (`EventRouteContext`); 9 of the repo's 14 hand-built `T00:00:00Z`-style date parses live in `src/lib/family-calendar` (`month-layout.ts`, `view.ts`, `form.ts`, `series.ts`, `days.ts`).

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | Load the feed link with SWR instead of a raw `useEffect` | ~12 | Low | 2 |
| 2 | Shared family helpers (`ToggleChip`, `memberDisplayName`, `NoFamilyState`, `useFamily`) | ~25 here | Low | 4 |
| 3 | `daysBetween` from `src/lib/calendar.ts` (see the reminders report) | ~3 | Low | 1 |
| 4 | Date parses through `src/lib/calendar.ts` helpers | ~0 lines; one rule | Low | 5 |
| 5 | `RouteContext` in `calendar/events/[id]` | ~1 | Low | 1 |

### 1. Load the feed link with SWR

**Why.** Audit D6's leftover, named in U10's brief. `subscribe-dialog.tsx:196–215` keeps `feed`, `loadError` and an `attempt` counter, and loads with a `useEffect` and a `current` flag; `retry()` resets all three. SWR does this with a key: loading, error, retry (`mutate()`), and no stale writes after unmount.

**Before**
```tsx
const [feed, setFeed] = useState<CalendarFeed | null | undefined>(undefined);
const [loadError, setLoadError] = useState("");
const [attempt, setAttempt] = useState(0);
useEffect(() => { let current = true; api.feedLink().then(…); return () => { current = false; }; }, [api, attempt]);
```

**After**
```tsx
const { data: feed, error, mutate } = useSWR(open ? ["calendar-feed", api] : null, () => api.feedLink());
// create / delete: await api.createFeedLink(); await mutate(created.feed, { revalidate: false });
```

**Files.** `subscribe-dialog.tsx`, maybe `calendar-api.tsx` (a key constant). **Lines saved.** ~12. **Risk.** Low: keep the preview's in-memory `api` working (the key includes it, or use the provider's API in the fetcher). **Proof.** `src/components/family-calendar/subscribe-dialog.test.tsx`; `npm test`.

### 2. Shared family helpers

See the to-dos report, proposal 1: one `ToggleChip` for `Chip` (and for "Who's going"), one `memberDisplayName`, one `NoFamilyState`, and `useFamily()` instead of `useSWR<FamilyResponse>(hasFamily ? FAMILY_API_KEY : null)`.

### 3 and 4. Date maths in one place

`series.ts:49` re-defines `daysBetween` (proposal 1 of the reminders report). More broadly, `src/lib/family-calendar` builds dates by hand in 9 places (`Date.parse(\`${date}T00:00:00Z\`)` and the like). Each is correct, but they are what D9 asks to centralise. When U10 is in these files, route them through `addDays`, `daysBetween`, `dateInMonth` and friends in `src/lib/calendar.ts`, and turn on the candidate rule `local/no-hand-date-parse` (see `docs/ui-audit.md`).

### 5. `RouteContext`

`EventRouteContext` in `src/app/api/calendar/events/[id]/route.ts`.

## Found on the way (for U10)

- **Agenda is already the phone default**, and it reads well at 390 px (date column, time, title, member initials). The plan says "the week view on phones"; Week on a phone is 3 narrow days. Check it against the mockup before changing the default.
- **Adding an event is 4 taps when the default time is right** (More → Calendar → Add event → Add event); the default start is the next whole hour today, so most real events also need the date and time pickers (2–4 more).
- **`week-view.tsx` has its own `useNow(enabled)`** that starts as `null` to avoid a hydration mismatch; keep that when sharing it.

## Tidy-ups

- `restCalendarApi`, `MONTH_MAX_DOTS`, `HOUR_PX`, `CALENDAR_REFRESH_MS`, `rangeKey`, `DEFAULT_MEMBER_FILTER`, `CALENDAR_MEMBER_PARAM`, `DEFAULT_REPEAT_COUNT`, `EVENT_LEAD_MINUTES`, `ALL_DAY_NOTIFY_TIME` and several types are exported but only used in their own file (or its test).

## Considered and rejected

- **Merging `feed-token.ts` with `src/lib/mcp/tokens.ts`** (token-shape similarity 0.68): deliberately modelled on each other, but different prefixes and storage; a shared generator would save ~10 lines in security-sensitive code. Not worth it.
- **One view component for Month and Week**: different layouts and maths (`month-layout.ts` vs `day-layout.ts`).

## Already simple

- `calendar-api.tsx` + `use-calendar-events.ts` with `src/lib/family-calendar/optimistic.ts`.
- The pure layout modules and their tests.

import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";

import { draftFor, draftToFields, toggleLeadTime } from "@/components/reminders/reminder-dialog";
import { DoneRow, ReminderRow } from "@/components/reminders/reminder-row";
import { RemindersScreen } from "@/components/reminders/reminders-screen";
import { defaultSnoozeUntil, snoozeUntilInstant } from "@/components/reminders/snooze-dialog";
import { ledgerSystem } from "@/components/ui/theme";
import { REMINDERS_API_KEY, type RemindersResponse } from "@/lib/api/keys";
import type { ListedReminder } from "@/lib/reminders/list";
import { dueAt, stateOf } from "@/lib/reminders/schedule";

// 12:00 in Bucharest on Saturday 24 October 2026.
const NOW = new Date("2026-10-24T09:00:00Z");
const TZ = "Europe/Bucharest";

function reminder(overrides: Partial<ListedReminder> = {}): ListedReminder {
  const base = {
    id: "r1", title: "Pay the rent", notes: "", startsOn: "2026-10-31", timeOfDay: "09:00", timezone: TZ,
    repeatUnit: "month" as const, repeatInterval: 1, leadMinutes: [0, 1440], notificationsMuted: false,
    nextDueOn: "2026-10-31", snoozedUntil: null, nextNotifyAt: null, expenseTemplate: null, createdAt: "", updatedAt: "",
    ...overrides,
  };
  const nextDueAt = base.nextDueOn === null ? null : dueAt(base, base.nextDueOn).toISOString();
  return { ...base, nextDueAt, state: stateOf(base, NOW) };
}

function render(node: ReactNode, data?: RemindersResponse) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ fetcher: () => new Promise(() => {}), fallback: data ? { [REMINDERS_API_KEY]: data } : {} }}>
        {node}
      </SWRConfig>
    </ChakraProvider>,
  );
}

const noop = () => {};

describe("ReminderRow", () => {
  it("shows the title, the next due date and time, the repeat and the actions", () => {
    const html = render(<ReminderRow reminder={reminder()} now={NOW} onComplete={noop} onSnooze={noop} onEdit={noop} />);
    expect(html).toContain("Pay the rent");
    expect(html).toContain("Sat 31 Oct, 09:00");
    expect(html).toContain("Monthly");
    expect(html).toContain("Mark done");
    expect(html).toContain("Snooze");
    expect(html).not.toContain("Notifications muted");
    expect(html).not.toMatch(/\d+ (minute|hour|day)s? late/);
  });

  it("says how late an overdue reminder is", () => {
    const html = render(<ReminderRow reminder={reminder({ nextDueOn: "2026-10-22", repeatUnit: "week", repeatInterval: 2 })} now={NOW} onComplete={noop} onSnooze={noop} onEdit={noop} />);
    expect(html).toContain("Every 2 weeks");
    expect(html).toContain("2 days late");
  });

  it("marks a muted reminder, a due-today one and a snoozed one", () => {
    const due = render(<ReminderRow reminder={reminder({ nextDueOn: "2026-10-24", timeOfDay: "18:00", notificationsMuted: true })} now={NOW} onComplete={noop} onSnooze={noop} onEdit={noop} />);
    expect(due).toContain("Notifications muted");
    expect(due).toContain("Today");
    const snoozed = render(<ReminderRow reminder={reminder({ nextDueOn: "2026-10-22", snoozedUntil: "2026-10-25T07:00:00.000Z" })} now={NOW} onComplete={noop} onSnooze={noop} onEdit={noop} />);
    expect(snoozed).toContain("Snoozed until Sun 25 Oct, 09:00");
    expect(snoozed).not.toMatch(/\d+ (minute|hour|day)s? late/);
  });

  it("disables the actions while a write is in flight", () => {
    const html = render(<ReminderRow reminder={reminder()} busy now={NOW} onComplete={noop} onSnooze={noop} onEdit={noop} />);
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});

describe("DoneRow", () => {
  it("shows when it was done, for which occurrence, and what's next", () => {
    const html = render(
      <DoneRow
        entry={{
          completion: { id: "c1", reminderId: "r1", occurrenceOn: "2026-09-30", doneAt: "2026-09-30T06:15:00.000Z", expenseId: null },
          reminder: reminder(),
        }}
        now={NOW}
        onEdit={noop}
      />,
    );
    expect(html).toContain("Done Wed 30 Sept, 09:15");
    expect(html).toContain("for Wed 30 Sept");
    expect(html).toContain("Next Sat 31 Oct");
  });
});

describe("RemindersScreen", () => {
  it("shows the overdue count and the empty Upcoming state", () => {
    const html = render(<RemindersScreen />, { reminders: [], completions: [] });
    expect(html).toContain("Upcoming");
    expect(html).toContain('aria-label="0 overdue"');
    expect(html).toContain("No reminders yet");
  });
});

describe("RemindersScreen with ?focus=<id>", () => {
  // States are worked out at the real time the screen renders, so the dates are far off.
  const late = reminder({ id: "late", title: "Renew the passport", repeatUnit: "none", startsOn: "2020-01-10", nextDueOn: "2020-01-10" });
  const soon = reminder({ id: "soon", title: "Pay the rent", startsOn: "2099-01-31", nextDueOn: "2099-01-31" });
  const finished = reminder({ id: "finished", title: "Book the dentist", repeatUnit: "none", startsOn: "2020-01-05", nextDueOn: null });
  const data: RemindersResponse = {
    reminders: [late, soon, finished],
    completions: [
      { id: "c1", reminderId: "finished", occurrenceOn: "2020-01-05", doneAt: "2020-01-05T08:00:00.000Z", expenseId: null },
    ],
  };

  /** The selected tab's label and the rows marked focused. */
  function focus(focusId: string | null) {
    const html = render(<RemindersScreen focusId={focusId} />, data);
    const selected = html.match(/aria-selected="true"[^>]*>([A-Za-z]+)/)?.[1];
    const focused = [...html.matchAll(/data-reminder-id="([^"]+)" data-focused=""/g)].map((match) => match[1]);
    return { selected, focused };
  }

  it("opens the tab that lists the reminder and highlights its row", () => {
    expect(focus("late")).toEqual({ selected: "Overdue", focused: ["late"] });
    expect(focus("soon")).toEqual({ selected: "Upcoming", focused: ["soon"] });
    expect(focus("finished")).toEqual({ selected: "Done", focused: ["finished"] });
  });

  it("stays on Upcoming with nothing highlighted for an unknown reminder or no focus", () => {
    expect(focus("deleted")).toEqual({ selected: "Upcoming", focused: [] });
    expect(focus(null)).toEqual({ selected: "Upcoming", focused: [] });
  });
});

describe("the reminder form", () => {
  it("starts a new reminder today at 09:00, once, notifying at the time", () => {
    expect(draftFor(undefined, "2026-10-24")).toEqual({
      title: "", notes: "", startsOn: "2026-10-24", timeOfDay: "09:00", repeatUnit: "none", repeatInterval: "1", leadMinutes: [0], notificationsMuted: false,
      expense: { enabled: false, amount: "", category: "housing", subtype: null },
    });
  });

  it("always sends every field, trimmed, for PATCH replaces the whole reminder", () => {
    const fields = draftToFields({ ...draftFor(reminder({ notes: "Flat 12" }), "2026-10-24"), title: "  Pay rent ", leadMinutes: [1440, 0] }, "EUR");
    expect(fields).toEqual({
      title: "Pay rent", notes: "Flat 12", startsOn: "2026-10-31", timeOfDay: "09:00", repeatUnit: "month", repeatInterval: 1,
      leadMinutes: [0, 1440], notificationsMuted: false, expenseTemplate: null,
    });
  });

  it("sends an interval of 1 for a one-off", () => {
    expect(draftToFields({ ...draftFor(undefined, "2026-10-24"), title: "Once", repeatInterval: "5" }, "EUR").repeatInterval).toBe(1);
    expect(draftToFields({ ...draftFor(undefined, "2026-10-24"), title: "Fortnightly", repeatUnit: "week", repeatInterval: "2" }, "EUR").repeatInterval).toBe(2);
  });

  it("toggles lead times, at most three", () => {
    expect(toggleLeadTime([0], 1440)).toEqual([0, 1440]);
    expect(toggleLeadTime([0, 1440], 0)).toEqual([1440]);
    expect(toggleLeadTime([0, 60, 1440], 10080)).toEqual([0, 60, 1440]);
  });
});

describe("snooze until", () => {
  it("suggests two hours from now, on the hour, in the reminder's time zone", () => {
    expect(defaultSnoozeUntil(new Date("2026-10-24T09:20:00Z"), TZ)).toEqual({ date: "2026-10-24", time: "14:00" });
  });

  it("reads the chosen time in the reminder's time zone and refuses the past", () => {
    expect(snoozeUntilInstant("2026-10-25", "09:00", TZ, NOW)).toEqual({ until: "2026-10-25T07:00:00.000Z" });
    expect(snoozeUntilInstant("2026-10-24", "11:00", TZ, NOW)).toEqual({ error: "Choose a time in the future." });
    expect(snoozeUntilInstant("", "11:00", TZ, NOW)).toEqual({ error: "Choose a date and a time." });
  });
});

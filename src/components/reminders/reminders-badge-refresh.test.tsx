import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReminderApiProvider, type ReminderApi } from "@/components/reminders/reminder-api";
import { ReminderRow } from "@/components/reminders/reminder-row";
import { ReminderTabSwitcher } from "@/components/reminders/reminders-screen";
import { useReminders, type RemindersState } from "@/components/reminders/use-reminders";
import { ledgerSystem } from "@/components/ui/theme";
import { REMINDERS_API_KEY, REMINDERS_SUMMARY_API_KEY, type RemindersResponse } from "@/lib/api/keys";
import type { ListedReminder } from "@/lib/reminders/list";

const keyMutate = vi.hoisted(() => vi.fn());

// The writes refresh the nav badge through the global `mutate`; spy on it.
vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return { ...actual, useSWRConfig: () => ({ ...actual.useSWRConfig(), mutate: keyMutate }) };
});

const NOW = new Date("2026-10-24T09:00:00Z");

const REMINDER: ListedReminder = {
  id: "r1", title: "Pay the rent", notes: "", startsOn: "2026-10-24", timeOfDay: "09:00", timezone: "Europe/Bucharest",
  repeatUnit: "month", repeatInterval: 1, leadMinutes: [0], notificationsMuted: false, nextDueOn: "2026-10-24",
  nextDueAt: "2026-10-24T06:00:00.000Z", snoozedUntil: null, nextNotifyAt: null, createdAt: "", updatedAt: "", state: "overdue",
};

const api: ReminderApi = {
  create: async () => REMINDER,
  update: async () => REMINDER,
  remove: async () => {},
  complete: async () => ({ ...REMINDER, nextDueOn: "2026-11-24", nextDueAt: "2026-11-24T07:00:00.000Z" }),
  snooze: async () => ({ ...REMINDER, snoozedUntil: "2026-10-24T10:00:00.000Z" }),
};

function wrap(node: ReactNode) {
  const data: RemindersResponse = { reminders: [REMINDER], completions: [] };
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ provider: () => new Map(), fetcher: () => new Promise(() => {}), fallback: { [REMINDERS_API_KEY]: data } }}>
        <ReminderApiProvider api={api}>{node}</ReminderApiProvider>
      </SWRConfig>
    </ChakraProvider>,
  );
}

/** The page's reminders state, from one render. */
function remindersState() {
  let state: RemindersState | undefined;
  function Probe() {
    state = useReminders(NOW);
    return null;
  }
  wrap(<Probe />);
  if (!state) throw new Error("not rendered");
  return state;
}

const FIELDS = {
  title: "Pay the rent", notes: "", startsOn: "2026-10-24", timeOfDay: "09:00", repeatUnit: "month" as const,
  repeatInterval: 1, leadMinutes: [0], notificationsMuted: false,
};

describe("the nav badge after a write on the reminders page", () => {
  beforeEach(() => keyMutate.mockClear());

  it.each([
    ["mark done", (state: RemindersState) => state.complete("r1")],
    ["snooze", (state: RemindersState) => state.snooze("r1", { kind: "hour" })],
    ["edit", (state: RemindersState) => state.update("r1", FIELDS)],
    ["add", (state: RemindersState) => state.add(FIELDS)],
    ["delete", (state: RemindersState) => state.remove("r1")],
  ])("refreshes the summary after %s", async (_name, write) => {
    await write(remindersState());
    expect(keyMutate).toHaveBeenCalledWith(REMINDERS_SUMMARY_API_KEY);
  });
});

describe("the phone layout", () => {
  it("switches tabs with a full-width segmented control carrying the overdue count", () => {
    const html = wrap(<ReminderTabSwitcher value="overdue" overdueCount={2} onValueChange={() => {}} />);
    expect(html).toContain('aria-label="Reminders"');
    expect(html).toContain(">Upcoming<");
    expect(html).toContain("Overdue · 2");
    expect(html).toContain('aria-label="Overdue, 2"');
    expect(html).toContain(">Done<");
    expect(html).toMatch(/value="overdue"[^>]*checked=""|checked=""[^>]*value="overdue"/);
  });

  it("names Overdue plainly when nothing is late", () => {
    const html = wrap(<ReminderTabSwitcher value="upcoming" overdueCount={0} onValueChange={() => {}} />);
    expect(html).toContain(">Overdue<");
    expect(html).not.toContain("Overdue ·");
  });

  it("puts a row's actions on their own line on a phone", () => {
    const html = wrap(<ReminderRow reminder={REMINDER} now={NOW} onComplete={() => {}} onSnooze={() => {}} onEdit={() => {}} />);
    const actions = html.match(/<div[^>]*data-row-actions=""[^>]*>/)?.[0] ?? "";
    expect(actions).not.toBe("");
    // The actions take the whole line below 768 px and share the row from `md`.
    expect(html).toMatch(/flex-basis:100%/);
    expect(html).toMatch(/@media screen and \(min-width: 48rem\)\{[^}]*flex-basis:auto/);
  });
});

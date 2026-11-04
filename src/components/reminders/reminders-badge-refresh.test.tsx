import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReminderApiProvider, type ReminderApi } from "@/components/reminders/reminder-api";
import { ReminderRow } from "@/components/reminders/reminder-row";
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
  nextDueAt: "2026-10-24T06:00:00.000Z", snoozedUntil: null, nextNotifyAt: null, expenseTemplate: null, createdAt: "", updatedAt: "", state: "overdue",
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
  repeatInterval: 1, leadMinutes: [0], notificationsMuted: false, expenseTemplate: null,
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

describe("a row's actions", () => {
  it("has Snooze and Done on the row itself, with the reminder's name, at every width", () => {
    const html = wrap(<ReminderRow reminder={REMINDER} now={NOW} onComplete={() => {}} onSnooze={() => {}} onEdit={() => {}} />);
    expect(html).toContain(`aria-label="Snooze ${REMINDER.title}"`);
    expect(html).toContain(`aria-label="Mark ${REMINDER.title} done"`);
  });
});

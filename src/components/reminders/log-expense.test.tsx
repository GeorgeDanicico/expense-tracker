import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmAmount, LogExpenseDialog } from "@/components/reminders/log-expense-dialog";
import { ReminderApiProvider, type ReminderApi } from "@/components/reminders/reminder-api";
import { draftFor, draftToFields } from "@/components/reminders/reminder-dialog";
import { DoneRow, loggedExpenseHref } from "@/components/reminders/reminder-row";
import { useReminders, type RemindersState } from "@/components/reminders/use-reminders";
import { ledgerSystem } from "@/components/ui/theme";
import { ApiError } from "@/lib/api/client";
import { REMINDERS_API_KEY, REMINDERS_SUMMARY_API_KEY, type RemindersResponse } from "@/lib/api/keys";
import type { ListedReminder } from "@/lib/reminders/list";

const keyMutate = vi.hoisted(() => vi.fn());

vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return { ...actual, useSWRConfig: () => ({ ...actual.useSWRConfig(), mutate: keyMutate }) };
});

const NOW = new Date("2026-10-24T09:00:00Z");
const RENT = { amount: 650, currency: "EUR", category: "housing", subtype: null } as const;

const REMINDER: ListedReminder = {
  id: "r1", title: "Pay the rent", notes: "", startsOn: "2026-10-24", timeOfDay: "09:00", timezone: "Europe/Bucharest",
  repeatUnit: "month", repeatInterval: 1, leadMinutes: [0], notificationsMuted: false, nextDueOn: "2026-10-24",
  nextDueAt: "2026-10-24T06:00:00.000Z", snoozedUntil: null, nextNotifyAt: null, expenseTemplate: RENT,
  createdAt: "", updatedAt: "", state: "overdue",
};

const complete = vi.fn<ReminderApi["complete"]>();

const api: ReminderApi = {
  create: async () => REMINDER,
  update: async () => REMINDER,
  remove: async () => {},
  complete,
  snooze: async () => REMINDER,
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

describe("the reminder form's Expense section", () => {
  it("starts off, and sends no template while off", () => {
    const draft = draftFor(undefined, "2026-10-24");
    expect(draft.expense.enabled).toBe(false);
    expect(draftToFields({ ...draft, title: "Rent", expense: { ...draft.expense, amount: "650" } }, "EUR").expenseTemplate).toBeNull();
  });

  it("sends the template in the account's currency when on", () => {
    const draft = draftFor(undefined, "2026-10-24");
    const fields = draftToFields({
      ...draft, title: "Fuel", expense: { enabled: true, amount: " 70.5 ", category: "car", subtype: "car_fuel" },
    }, "RON");
    expect(fields.expenseTemplate).toEqual({ amount: 70.5, currency: "RON", category: "car", subtype: "car_fuel" });
  });

  it("drops a subtype that doesn't belong to the category, and sends 0 for a blank amount (refused by the server)", () => {
    const draft = draftFor(undefined, "2026-10-24");
    const fields = draftToFields({
      ...draft, title: "Rent", expense: { enabled: true, amount: "", category: "housing", subtype: "car_fuel" },
    }, "EUR");
    expect(fields.expenseTemplate).toEqual({ amount: 0, currency: "EUR", category: "housing", subtype: null });
  });

  it("fills the section from a reminder's template, and keeps it on save", () => {
    const draft = draftFor(REMINDER, "2026-10-24");
    expect(draft.expense).toEqual({ enabled: true, amount: "650", category: "housing", subtype: null });
    expect(draftToFields(draft, "EUR").expenseTemplate).toEqual(RENT);
  });
});

describe("the mark-done confirm", () => {
  it("reads the typed amount, refusing anything that isn't above zero", () => {
    expect(confirmAmount("650")).toBe(650);
    expect(confirmAmount(" 12.30 ")).toBe(12.3);
    expect(confirmAmount("")).toBeNull();
    expect(confirmAmount("0")).toBeNull();
    expect(confirmAmount("-3")).toBeNull();
    expect(confirmAmount("abc")).toBeNull();
  });

  it("renders without crashing while closed", () => {
    expect(() => wrap(
      <LogExpenseDialog
        reminder={REMINDER}
        template={RENT}
        occurrenceOn="2026-10-24"
        currency="EUR"
        open={false}
        onOpenChange={() => {}}
        onLog={async () => {}}
        onJustDone={() => {}}
        now={NOW}
      />,
    )).not.toThrow();
  });
});

describe("logging from the reminders page", () => {
  beforeEach(() => {
    keyMutate.mockClear();
    complete.mockReset();
  });

  it("sends the occurrence and amount, then refreshes the expenses, the dashboard and the badge", async () => {
    complete.mockResolvedValue({ ...REMINDER, nextDueOn: "2026-11-24", nextDueAt: "2026-11-24T07:00:00.000Z" });

    await remindersState().completeWithExpense("r1", { occurrenceOn: "2026-10-24", amount: 640 });

    expect(complete).toHaveBeenCalledWith("r1", { occurrenceOn: "2026-10-24", amount: 640 });
    const filters = keyMutate.mock.calls.map(([key]) => key).filter((key) => typeof key === "function") as ((key: unknown) => boolean)[];
    expect(filters.some((matches) => matches("/api/expenses?month=2026-10"))).toBe(true);
    expect(filters.some((matches) => matches("/api/dashboard?period=3m"))).toBe(true);
    expect(keyMutate).toHaveBeenCalledWith(REMINDERS_SUMMARY_API_KEY);
  });

  it("passes a refusal on to the confirm, untouched, and refreshes nothing of the expenses", async () => {
    complete.mockRejectedValue(new ApiError("This reminder was already marked done somewhere else, so no expense was added.", 409));

    await expect(remindersState().completeWithExpense("r1", { occurrenceOn: "2026-10-24" }))
      .rejects.toThrow("so no expense was added");
    const filters = keyMutate.mock.calls.map(([key]) => key).filter((key) => typeof key === "function") as ((key: unknown) => boolean)[];
    expect(filters.some((matches) => matches("/api/expenses?month=2026-10"))).toBe(false);
    expect(keyMutate).toHaveBeenCalledWith(REMINDERS_SUMMARY_API_KEY);
  });

  it("keeps the plain mark done body-less", async () => {
    complete.mockResolvedValue(REMINDER);

    await remindersState().complete("r1");

    expect(complete).toHaveBeenCalledWith("r1");
  });
});

describe("the Done tab", () => {
  const entry = (expenseId: string | null) => ({
    completion: { id: "c1", reminderId: "r1", occurrenceOn: "2026-09-30", doneAt: "2026-09-30T06:15:00.000Z", expenseId },
    reminder: REMINDER,
  });

  it("links a logged expense to its month", () => {
    const html = wrap(<DoneRow entry={entry("e1")} now={NOW} onEdit={() => {}} />);
    expect(loggedExpenseHref("2026-09-30")).toBe("/expenses?month=2026-09");
    expect(html).toContain("Expense logged");
    expect(html).toContain('href="/expenses?month=2026-09"');
  });

  it("shows no marker without an expense (none logged, or deleted since)", () => {
    expect(wrap(<DoneRow entry={entry(null)} now={NOW} onEdit={() => {}} />)).not.toContain("Expense logged");
  });
});

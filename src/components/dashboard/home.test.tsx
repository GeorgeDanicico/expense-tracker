import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeScreen } from "@/components/dashboard/home-screen";
import { ReminderApiProvider, type ReminderApi } from "@/components/reminders/reminder-api";
import { useReminderActions } from "@/components/reminders/use-reminder-actions";
import { useReminders } from "@/components/reminders/use-reminders";
import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY, dashboardApiKey, REMINDERS_API_KEY, todosApiKey, type RemindersResponse, type TodosResponse } from "@/lib/api/keys";
import type { DashboardData } from "@/lib/expenses/types";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import type { ListedReminder } from "@/lib/reminders/list";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";
import type { Todo } from "@/lib/todos/types";
import { anExpense } from "@/test/builders";

// 4 Nov 2026, 11:00 in Bucharest.
const NOW = new Date("2026-11-04T09:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const account = (membership: AccountData["membership"]): AccountData => ({
  email: "ana@example.com", signInName: "ana@example.com", currency: "EUR", features: { family: true }, membership, mustChangePassword: false, avatarUrl: null,
});
const parent: AccountData["membership"] = { memberId: "m1", role: "parent", isCreator: true, familyName: "Popescu", permissions: PARENT_PERMISSIONS };
const kidWithoutExpenses: AccountData["membership"] = {
  memberId: "m2", role: "kid", isCreator: false, familyName: "Popescu", permissions: { ...DEFAULT_KID_PERMISSIONS, expenses: "off" },
};

const reminder = (id: string, state: ListedReminder["state"], nextDueOn: string, nextDueAt: string, timeOfDay = "09:00"): ListedReminder => ({
  id, title: `Reminder ${id}`, notes: "", startsOn: nextDueOn, timeOfDay, timezone: "Europe/Bucharest", repeatUnit: "none", repeatInterval: 1,
  leadMinutes: [0], notificationsMuted: false, nextDueOn, nextDueAt, snoozedUntil: null, nextNotifyAt: null, expenseTemplate: null,
  createdAt: "", updatedAt: "", state,
});
const REMINDERS: ListedReminder[] = [
  reminder("late", "overdue", "2026-11-03", "2026-11-03T07:00:00.000Z"),
  reminder("today", "due", "2026-11-04", "2026-11-04T15:30:00.000Z", "17:30"),
  reminder("tonight", "due", "2026-11-04", "2026-11-04T18:00:00.000Z", "20:00"),
  reminder("fourth", "due", "2026-11-04", "2026-11-04T19:00:00.000Z", "21:00"),
  reminder("later", "upcoming", "2026-11-09", "2026-11-09T07:00:00.000Z"),
];

const expense = (id: string, day: string) => anExpense({ id, description: `Expense ${id}`, expenseDate: day, amount: 12.5 });
const DASHBOARD: DashboardData = {
  currentMonth: "2026-11",
  currentExpenses: ["1", "2", "3", "4", "5"].map((id) => expense(id, "2026-11-03")),
  currentTotal: 250, currentCount: 5, currentAverage: 50, currentLargest: 100,
  analytics: { label: "", total: 1000, count: 9, monthlyAverage: 500, topCategory: "", categoryTotals: [], series: [{ key: "2026-10", label: "October", total: 1000 }] },
};

const todo = (id: string, memberId: string | null, status: Todo["status"] = "todo"): Todo => ({
  id, title: `Todo ${id}`, notes: "", status, position: id, dueDate: "2026-11-06", createdBy: null, createdAt: "", updatedAt: "", completedAt: null, completedBy: null,
  assignee: memberId ? { memberId, name: "Someone", color: null, avatarUrl: null } : null,
});
const TODOS: TodosResponse = { todos: [todo("mine", "m1"), todo("done", "m1", "done"), todo("theirs", "m3"), todo("hers", "m2")] };

const api: ReminderApi = {
  create: async () => REMINDERS[0],
  update: async () => REMINDERS[0],
  remove: async () => {},
  complete: async () => REMINDERS[0],
  snooze: async () => REMINDERS[0],
};

function renderHome(membership: AccountData["membership"]) {
  const fallback = {
    [ACCOUNT_API_KEY]: account(membership),
    [dashboardApiKey({ period: "3m", granularity: "month", customDate: "2026-11" }, null)]: DASHBOARD,
    [REMINDERS_API_KEY]: { reminders: REMINDERS, completions: [] } satisfies RemindersResponse,
    [todosApiKey(null)]: TODOS,
  };
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ provider: () => new Map(), fetcher: () => new Promise(() => {}), fallback }}>
        <ReminderApiProvider api={api}>
          <HomeScreen />
        </ReminderApiProvider>
      </SWRConfig>
    </ChakraProvider>,
  );
}

const links = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href]) => href);
const rows = (html: string, text: string) => html.match(new RegExp(text, "g"))?.length ?? 0;

describe("Home for a parent", () => {
  let html = "";
  beforeEach(() => {
    html = renderHome(parent);
  });

  it("greets and dates the day", () => {
    expect(html).toContain("Good morning");
    expect(html).toContain("Wednesday 4 November");
  });

  it("shows the month against last month", () => {
    expect(html).toContain("Spent in November");
    expect(html).toContain("25% of October");
    expect(html).not.toContain("over October");
  });

  it("lists three reminders, overdue first, with Done and Snooze on each row, and counts the rest", () => {
    expect(html.indexOf("Reminder late")).toBeLessThan(html.indexOf("Reminder today"));
    expect(html).toContain("Overdue · 1 day late");
    expect(html).toContain("Today · 17:30");
    expect(html).not.toContain("Reminder fourth");
    expect(html).not.toContain("Reminder later");
    expect(html).toContain("+1 more due");
    for (const id of ["late", "today", "tonight"]) {
      expect(html).toContain(`aria-label="Mark Reminder ${id} done"`);
      expect(html).toContain(`aria-label="Snooze Reminder ${id}"`);
    }
  });

  it("lists the five latest expenses, with the day and the category", () => {
    expect(rows(html, "Expense \\d")).toBe(5);
    expect(html).toContain("Yesterday · Groceries");
  });

  it("lists the open to-dos assigned to the member and no one else's", () => {
    expect(html).toContain("To-dos for you");
    expect(html).toContain("Todo mine");
    expect(html).not.toContain("Todo done");
    expect(html).not.toContain("Todo theirs");
    expect(html).not.toContain("Todo hers");
  });

  it("links each block to its section", () => {
    expect(links(html)).toEqual(expect.arrayContaining(["/insights", "/reminders", "/expenses", "/todos"]));
  });
});

describe("Home without a family", () => {
  let html = "";
  beforeEach(() => {
    html = renderHome(null);
  });

  it("has no family to-dos block", () => {
    expect(html).not.toContain("To-dos for you");
    expect(links(html)).not.toContain("/todos");
  });

  it("keeps the spending and the reminders", () => {
    expect(html).toContain("Spent in November");
    expect(html).toContain("Recent expenses");
    expect(html).toContain("Due today");
  });
});

describe("Home for a kid without the expenses permission", () => {
  let html = "";
  beforeEach(() => {
    html = renderHome(kidWithoutExpenses);
  });

  it("hides the spending blocks and their links", () => {
    expect(html).not.toContain("Spent in");
    expect(html).not.toContain("Recent expenses");
    expect(links(html)).not.toContain("/insights");
    expect(links(html)).not.toContain("/expenses");
  });

  it("keeps the reminders and the to-dos assigned to the kid", () => {
    expect(html).toContain("Due today");
    expect(html).toContain("Reminder late");
    expect(html).toContain("Todo hers");
    expect(html).not.toContain("Todo mine");
  });
});

describe("Done and Snooze on Home", () => {
  const complete = vi.fn<ReminderApi["complete"]>();
  const snooze = vi.fn<ReminderApi["snooze"]>();
  const writes: ReminderApi = { ...api, complete, snooze };

  /** The cache behind the page, so a test can look at what a row shows while a write is in flight. */
  function mount() {
    const cache = new Map([[REMINDERS_API_KEY, { data: { reminders: REMINDERS, completions: [] } satisfies RemindersResponse }]]);
    const done = vi.fn();
    let actions!: ReturnType<typeof useReminderActions>;
    function Probe() {
      const state = useReminders(NOW);
      actions = useReminderActions(state, NOW, done);
      return null;
    }
    renderToStaticMarkup(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ provider: () => cache, fetcher: () => new Promise(() => {}) }}>
          <ReminderApiProvider api={writes}>
            <Probe />
          </ReminderApiProvider>
        </SWRConfig>
      </ChakraProvider>,
    );
    const stored = () => (cache.get(REMINDERS_API_KEY)?.data as RemindersResponse | undefined)?.reminders.find((item) => item.id === "today");
    return { actions, done, stored };
  }

  beforeEach(() => {
    complete.mockReset();
    snooze.mockReset();
  });

  it("marks a reminder done with one call, showing it at once and saying so when it worked", async () => {
    let answer!: (value: ListedReminder) => void;
    complete.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { actions, done, stored } = mount();
    const target = REMINDERS[1];

    const marking = actions.complete(target);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("today"));
    // One-off: done at once means no next occurrence.
    expect(stored()?.nextDueOn).toBeNull();
    expect(done).not.toHaveBeenCalled();

    answer({ ...target, nextDueOn: null, nextDueAt: null, state: "done" });
    await marking;
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith("Marked done"));
  });

  it("puts the reminder back, and says nothing, when the server refuses Done", async () => {
    complete.mockRejectedValue(new Error("No."));
    const { actions, done, stored } = mount();

    actions.complete(REMINDERS[1]);
    await vi.waitFor(() => expect(complete).toHaveBeenCalled());
    await vi.waitFor(() => expect(stored()?.nextDueOn).toBe("2026-11-04"));
    expect(done).not.toHaveBeenCalled();
  });

  it("snoozes with the chosen preset and puts the reminder back when refused", async () => {
    snooze.mockRejectedValue(new Error("No."));
    const { actions, done, stored } = mount();

    actions.snooze(REMINDERS[1], "hour");
    await vi.waitFor(() => expect(snooze).toHaveBeenCalledWith("today", { kind: "hour" }));
    await vi.waitFor(() => expect(stored()?.snoozedUntil).toBeNull());
    expect(done).not.toHaveBeenCalled();
  });

  it("says Snoozed when the snooze worked", async () => {
    snooze.mockResolvedValue({ ...REMINDERS[1], snoozedUntil: "2026-11-04T10:00:00.000Z" });
    const { actions, done } = mount();
    actions.snooze(REMINDERS[1], "tomorrow");
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith("Snoozed"));
  });
});

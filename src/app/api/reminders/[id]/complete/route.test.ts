import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import { asKid, asOutsider, asParent, kidUser } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/reminders/[id]/complete/route";

const missingId = "90000000-0000-4000-8000-000000000404";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  asKid(repositories);
  repositories.reminders.callerId = kidUser.id;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function complete(id: string, body?: unknown) {
  return callRoute(POST, { method: "POST", params: { id }, body });
}

const rent = { amount: 650, currency: "EUR", category: "housing", subtype: null } as const;

describe("POST /api/reminders/[id]/complete", () => {
  it("answers 401 to an anonymous caller", async () => {
    const reminder = repositories.reminders.seed();
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await complete(reminder.id)).status).toBe(401);
    expect(repositories.reminders.completions).toEqual([]);
  });

  it("marks a one-off done, and answers 409 to a second call", async () => {
    const reminder = repositories.reminders.seed({ snoozedUntil: "2026-10-24T13:00:00.000Z" });

    expect(await complete(reminder.id)).toMatchObject({
      status: 200,
      body: { reminder: { id: reminder.id, nextDueOn: null, nextDueAt: null, snoozedUntil: null, state: "done" } },
    });
    expect(await complete(reminder.id)).toMatchObject({ status: 409, body: { error: "This reminder is already done." } });
    expect(repositories.reminders.completions).toEqual([expect.objectContaining({ reminderId: reminder.id, occurrenceOn: "2026-11-01" })]);
  });

  it("moves a monthly reminder two months when completed twice in a row", async () => {
    const reminder = repositories.reminders.seed({
      repeatUnit: "month",
      startsOn: "2026-10-15",
      nextDueOn: "2026-10-15",
      nextDueAt: "2026-10-15T06:00:00.000Z",
    });

    expect(await complete(reminder.id)).toMatchObject({ status: 200, body: { reminder: { nextDueOn: "2026-11-15", state: "upcoming" } } });
    expect(await complete(reminder.id)).toMatchObject({
      status: 200,
      body: { reminder: { nextDueOn: "2026-12-15", nextDueAt: "2026-12-15T07:00:00.000Z" } },
    });
    expect(repositories.reminders.completions.map((completion) => completion.occurrenceOn)).toEqual(["2026-10-15", "2026-11-15"]);
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect((await complete("not-a-uuid")).status).toBe(400);
  });

  it("answers 404 to a reminder that doesn't exist", async () => {
    expect(await complete(missingId)).toMatchObject({ status: 404, body: { error: "Reminder not found." } });
  });

  it.each([
    ["another user", asOutsider],
    ["a parent of the owner", asParent],
  ] as const)("answers 404 to %s without completing", async (_label, signIn) => {
    const reminder = repositories.reminders.seed();
    repositories.reminders.callerId = signIn(repositories).id;

    expect((await complete(reminder.id)).status).toBe(404);
    expect(reminder.nextDueOn).toBe("2026-11-01");
    expect(repositories.reminders.completions).toEqual([]);
  });

  describe("with { logExpense: true }", () => {
    function kidExpenses() {
      return repositories.expenses.expenses.get(kidUser.id) ?? [];
    }

    it("adds the expense as the caller and links it on the completion", async () => {
      const reminder = repositories.reminders.seed({ repeatUnit: "month", expenseTemplate: rent });

      const response = await complete(reminder.id, { logExpense: true, occurrenceOn: "2026-11-01" });

      expect(response).toMatchObject({
        status: 200,
        body: {
          reminder: { id: reminder.id, nextDueOn: "2026-12-01" },
          expense: { description: "Pay rent", amount: 650, category: "housing", subtype: null, expenseDate: "2026-11-01" },
        },
      });
      expect(kidExpenses()).toHaveLength(1);
      expect(repositories.reminders.completions).toEqual([
        expect.objectContaining({ occurrenceOn: "2026-11-01", expenseId: response.body.expense.id }),
      ]);
    });

    it("takes a changed amount", async () => {
      const reminder = repositories.reminders.seed({ expenseTemplate: rent });

      expect(await complete(reminder.id, { logExpense: true, amount: 640 }))
        .toMatchObject({ status: 200, body: { expense: { amount: 640 } } });
    });

    it("only marks done without logExpense, even on a reminder with a template", async () => {
      const reminder = repositories.reminders.seed({ expenseTemplate: rent });

      const response = await complete(reminder.id, { logExpense: false });

      expect(response).toMatchObject({ status: 200, body: { reminder: { state: "done" } } });
      expect(response.body.expense).toBeUndefined();
      expect(kidExpenses()).toEqual([]);
      expect(repositories.reminders.completions).toEqual([expect.objectContaining({ expenseId: null })]);
    });

    it("answers 409 and adds nothing when the occurrence was already marked done", async () => {
      const reminder = repositories.reminders.seed({ repeatUnit: "month", expenseTemplate: rent });
      await complete(reminder.id);

      expect(await complete(reminder.id, { logExpense: true, occurrenceOn: "2026-11-01" })).toMatchObject({
        status: 409, body: { error: "This reminder was already marked done somewhere else, so no expense was added. The list is up to date now." },
      });
      expect(kidExpenses()).toEqual([]);
      expect(repositories.reminders.completions).toHaveLength(1);
    });

    it("answers 422 for a reminder without a template", async () => {
      const reminder = repositories.reminders.seed();

      expect(await complete(reminder.id, { logExpense: true })).toMatchObject({
        status: 422, body: { error: "This reminder has no expense to log. Edit it to add one." },
      });
      expect(reminder.nextDueOn).toBe("2026-11-01");
    });

    it("answers 422 with field errors to an invalid body", async () => {
      const reminder = repositories.reminders.seed({ expenseTemplate: rent });

      expect(await complete(reminder.id, { logExpense: true, amount: 0 })).toMatchObject({
        status: 422, body: { fieldErrors: { amount: ["Amount must be greater than zero."] } },
      });
      expect(kidExpenses()).toEqual([]);
    });

    it("answers 500 and marks nothing done when the expense can't be added", async () => {
      const reminder = repositories.reminders.seed({ expenseTemplate: rent });
      vi.spyOn(repositories.expenses, "create").mockRejectedValueOnce(new Error("boom"));

      expect(await complete(reminder.id, { logExpense: true })).toMatchObject({
        status: 500, body: { error: "Unable to mark the reminder done." },
      });
      expect(reminder.nextDueOn).toBe("2026-11-01");
      expect(repositories.reminders.completions).toEqual([]);
    });

    it("answers 404 to another user's reminder without adding an expense", async () => {
      const reminder = repositories.reminders.seed({ expenseTemplate: rent });
      repositories.reminders.callerId = asOutsider(repositories).id;

      expect((await complete(reminder.id, { logExpense: true })).status).toBe(404);
      expect([...repositories.expenses.expenses.values()].flat()).toEqual([]);
    });
  });
});

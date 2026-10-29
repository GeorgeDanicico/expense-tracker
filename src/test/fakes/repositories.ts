import type { Repositories } from "@/lib/repositories";

import { FakeAccountRepository } from "./account";
import { FakeAvatarRepository } from "./avatars";
import { FakeCalendarFeedRepository, FakeCalendarRepository } from "./calendar";
import { FakeExpenseTabRepository } from "./expense-tabs";
import { FakeFamilyRepository } from "./family";
import { FakeExpenseRepository } from "./expenses";
import { FakeImportRepository } from "./imports";
import { FakeInvestmentRepository } from "./investments";
import { FakeMcpTokenRepository } from "./mcp-tokens";
import { FakeNetWorthRepository } from "./net-worth";
import { FakeNoticeRepository } from "./notices";
import { FakeNotificationSettingsRepository } from "./notification-settings";
import { FakeReminderRepository } from "./reminders";
import { FakeTodoRepository } from "./todos";

/**
 * In-memory stand-in for `@/lib/repositories`. A route or MCP test swaps it in with one line,
 * next to its other `vi.mock` calls:
 *
 *   vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
 *
 * Then `resetFakeRepositories()` in `beforeEach` returns fresh, empty fakes, and the code under test
 * gets those same objects from `getRepositories()`. Seed and inspect them directly in the test.
 */
export type FakeRepositories = {
  account: FakeAccountRepository;
  avatars: FakeAvatarRepository;
  calendar: FakeCalendarRepository;
  calendarFeeds: FakeCalendarFeedRepository;
  expenseTabs: FakeExpenseTabRepository;
  family: FakeFamilyRepository;
  imports: FakeImportRepository;
  investments: FakeInvestmentRepository;
  expenses: FakeExpenseRepository;
  mcpTokens: FakeMcpTokenRepository;
  netWorth: FakeNetWorthRepository;
  notices: FakeNoticeRepository;
  notificationSettings: FakeNotificationSettingsRepository;
  reminders: FakeReminderRepository;
  todos: FakeTodoRepository;
};

let current: FakeRepositories | undefined;

export function resetFakeRepositories(): FakeRepositories {
  const family = new FakeFamilyRepository();
  const expenses = new FakeExpenseRepository();
  current = {
    account: new FakeAccountRepository(),
    avatars: new FakeAvatarRepository(),
    // Acts as the caller the family fake describes: seed `family.membership` and `family.family` first.
    calendar: new FakeCalendarRepository(family),
    calendarFeeds: new FakeCalendarFeedRepository(),
    expenseTabs: new FakeExpenseTabRepository(),
    family,
    // Acts as the test user; confirm and undo work on `expenses`.
    imports: new FakeImportRepository(expenses),
    investments: new FakeInvestmentRepository(),
    expenses,
    mcpTokens: new FakeMcpTokenRepository(),
    netWorth: new FakeNetWorthRepository(),
    notices: new FakeNoticeRepository(),
    notificationSettings: new FakeNotificationSettingsRepository(),
    reminders: new FakeReminderRepository(),
    // Acts as the caller the family fake describes: seed `family.membership` and `family.family` first.
    todos: new FakeTodoRepository(family),
  };
  const { reminders } = current;
  current.expenses.onDelete = (id) => reminders.expenseDeleted(id);
  return current;
}

export function getRepositories(): Repositories {
  if (!current) throw new Error("Call resetFakeRepositories() before the code under test runs.");
  return current;
}

import type { Repositories } from "@/lib/repositories";

import { FakeAccountRepository } from "./account";
import { FakeExpenseTabRepository } from "./expense-tabs";
import { FakeFamilyRepository } from "./family";
import { FakeInvestmentRepository } from "./investments";
import { FakeExpenseRepository } from "./expenses";
import { FakeNetWorthRepository } from "./net-worth";

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
  expenseTabs: FakeExpenseTabRepository;
  family: FakeFamilyRepository;
  investments: FakeInvestmentRepository;
  expenses: FakeExpenseRepository;
  netWorth: FakeNetWorthRepository;
};

let current: FakeRepositories | undefined;

export function resetFakeRepositories(): FakeRepositories {
  current = {
    account: new FakeAccountRepository(),
    expenseTabs: new FakeExpenseTabRepository(),
    family: new FakeFamilyRepository(),
    investments: new FakeInvestmentRepository(),
    expenses: new FakeExpenseRepository(),
    netWorth: new FakeNetWorthRepository(),
  };
  return current;
}

export function getRepositories(): Repositories {
  if (!current) throw new Error("Call resetFakeRepositories() before the code under test runs.");
  return current;
}

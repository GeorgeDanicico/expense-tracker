import "server-only";

import type { AccountRepository } from "@/lib/account/repository";
import type { ExpenseTabRepository } from "@/lib/expenses/tab-repository";
import type { InvestmentRepository } from "@/lib/investments/repository";
import type { NetWorthRepository } from "@/lib/net-worth/repository";
import { supabaseAccountRepository } from "@/lib/supabase/repositories/account";
import { supabaseExpenseTabRepository } from "@/lib/supabase/repositories/expense-tabs";
import { supabaseInvestmentRepository } from "@/lib/supabase/repositories/investments";
import { supabaseNetWorthRepository } from "@/lib/supabase/repositories/net-worth";

/** Every repository the app uses. Each repository task adds its own key here. */
export type Repositories = {
  account: AccountRepository;
  expenseTabs: ExpenseTabRepository;
  investments: InvestmentRepository;
  netWorth: NetWorthRepository;
};

/**
 * The composition root for storage: the only place that picks the Supabase implementations.
 * Call it inside a request (a route handler or an MCP tool), not at module level; the
 * implementations act as that request's caller through `createClient()`.
 * Tests swap it for in-memory fakes; see `src/test/fakes/repositories.ts`.
 */
export function getRepositories(): Repositories {
  return {
    account: supabaseAccountRepository,
    expenseTabs: supabaseExpenseTabRepository,
    investments: supabaseInvestmentRepository,
    netWorth: supabaseNetWorthRepository,
  };
}

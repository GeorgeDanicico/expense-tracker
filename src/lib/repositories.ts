import "server-only";

import type { AccountRepository } from "@/lib/account/repository";
import type { NoticeRepository } from "@/lib/account/notice-repository";
import type { AiGateRepository } from "@/lib/ai/repository";
import type { AvatarRepository } from "@/lib/avatars/repository";
import type { CalendarFeedRepository } from "@/lib/family-calendar/feed-repository";
import type { CalendarRepository } from "@/lib/family-calendar/repository";
import type { ExpenseRepository } from "@/lib/expenses/repository";
import type { ExpenseTabRepository } from "@/lib/expenses/tab-repository";
import type { FamilyRepository } from "@/lib/family/repository";
import type { ImportRepository } from "@/lib/imports/repository";
import type { InvestmentRepository } from "@/lib/investments/repository";
import type { McpTokenRepository } from "@/lib/mcp/token-repository";
import type { NetWorthRepository } from "@/lib/net-worth/repository";
import type { NotificationSettingsRepository } from "@/lib/notifications/settings-repository";
import type { ReminderRepository } from "@/lib/reminders/repository";
import type { TodoRepository } from "@/lib/todos/repository";
import { supabaseAccountRepository } from "@/lib/supabase/repositories/account";
import { supabaseAiGateRepository } from "@/lib/supabase/repositories/ai";
import { supabaseAvatarRepository } from "@/lib/supabase/repositories/avatars";
import { supabaseCalendarFeedRepository } from "@/lib/supabase/repositories/calendar-feeds";
import { supabaseCalendarRepository } from "@/lib/supabase/repositories/calendar";
import { supabaseExpenseTabRepository } from "@/lib/supabase/repositories/expense-tabs";
import { supabaseExpenseRepository } from "@/lib/supabase/repositories/expenses";
import { supabaseFamilyRepository } from "@/lib/supabase/repositories/family";
import { supabaseImportRepository } from "@/lib/supabase/repositories/imports";
import { supabaseInvestmentRepository } from "@/lib/supabase/repositories/investments";
import { supabaseMcpTokenRepository } from "@/lib/supabase/repositories/mcp-tokens";
import { supabaseNetWorthRepository } from "@/lib/supabase/repositories/net-worth";
import { supabaseNoticeRepository } from "@/lib/supabase/repositories/notices";
import { supabaseNotificationSettingsRepository } from "@/lib/supabase/repositories/notification-settings";
import { supabaseReminderRepository } from "@/lib/supabase/repositories/reminders";
import { supabaseTodoRepository } from "@/lib/supabase/repositories/todos";

/** Every repository the app uses. Each repository task adds its own key here. */
export type Repositories = {
  account: AccountRepository;
  aiGate: AiGateRepository;
  avatars: AvatarRepository;
  calendar: CalendarRepository;
  calendarFeeds: CalendarFeedRepository;
  expenseTabs: ExpenseTabRepository;
  family: FamilyRepository;
  imports: ImportRepository;
  investments: InvestmentRepository;
  expenses: ExpenseRepository;
  mcpTokens: McpTokenRepository;
  netWorth: NetWorthRepository;
  notices: NoticeRepository;
  notificationSettings: NotificationSettingsRepository;
  reminders: ReminderRepository;
  todos: TodoRepository;
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
    aiGate: supabaseAiGateRepository,
    avatars: supabaseAvatarRepository,
    calendar: supabaseCalendarRepository,
    calendarFeeds: supabaseCalendarFeedRepository,
    expenseTabs: supabaseExpenseTabRepository,
    family: supabaseFamilyRepository,
    imports: supabaseImportRepository,
    investments: supabaseInvestmentRepository,
    expenses: supabaseExpenseRepository,
    mcpTokens: supabaseMcpTokenRepository,
    netWorth: supabaseNetWorthRepository,
    notices: supabaseNoticeRepository,
    notificationSettings: supabaseNotificationSettingsRepository,
    reminders: supabaseReminderRepository,
    todos: supabaseTodoRepository,
  };
}

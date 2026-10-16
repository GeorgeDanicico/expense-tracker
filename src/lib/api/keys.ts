import type { AnalyticsFilters } from "@/lib/expenses/types";
import { resolveMainExpenseMonth } from "@/lib/calendar";
import { expenseTabFilterParams, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { AccountNotice } from "@/lib/account/notice-repository";
import type { FamilyData, FamilyInvite } from "@/lib/family/repository";

// Each key notes the response type its GET returns. Types owned by a domain
// module are referenced there; wrapper shapes that only exist on the wire live here.

/** GET → `AccountData` (`@/lib/account/types`); PATCH returns the updated `AccountData`. */
export const ACCOUNT_API_KEY = "/api/account";
/** POST only: `{ password }` → 204. Not fetched with SWR; refresh `ACCOUNT_API_KEY` afterwards. */
export const ACCOUNT_PASSWORD_API_URL = "/api/account/password";
/** PATCH only: `{ email }` → 204. The change applies once the link sent to the new address is opened. */
export const ACCOUNT_EMAIL_API_URL = "/api/account/email";
/** GET → {@link NoticesResponse}: the unseen notices, oldest first. 404 while the family flag is off. */
export const ACCOUNT_NOTICES_API_KEY = "/api/account/notices";
/** GET → `InvestmentsOverview` (`@/lib/investments/types`). */
export const INVESTMENTS_API_KEY = "/api/investments";
/** GET → `NetWorthOverview` (`@/lib/net-worth/types`). */
export const NET_WORTH_API_KEY = "/api/net-worth";
/** GET → {@link FamilyResponse}; POST `{ name }` returns {@link FamilyResponse} with the new family (201). */
export const FAMILY_API_KEY = "/api/family";
/** GET → {@link InvitesResponse}: the pending invites, newest first (parents only); POST `{ role, permissions? }` → {@link CreatedInvite} (201). */
export const FAMILY_INVITES_API_KEY = "/api/family/invites";
/** DELETE only → 204: revokes the invite. */
export function familyInviteApiUrl(id: string) {
  return `${FAMILY_INVITES_API_KEY}/${encodeURIComponent(id)}`;
}
/** POST only: `{ code }` → `InvitePreview` (`@/lib/family/repository`), or 404 for a code that can't be redeemed. */
export const FAMILY_JOIN_PREVIEW_API_URL = "/api/family/join/preview";
/** POST only: `{ code }` → {@link FamilyResponse} with the joined family (201). */
export const FAMILY_JOIN_API_URL = "/api/family/join";
/** POST only → 204: marks the notice as seen. */
export function dismissNoticeApiUrl(id: string) {
  return `${ACCOUNT_NOTICES_API_KEY}/${encodeURIComponent(id)}/dismiss`;
}

/** GET → {@link TabsResponse}; POST returns {@link SavedTabResponse}. */
export const EXPENSE_TABS_API_KEY = "/api/expense-tabs";

export type NoticesResponse = { notices: AccountNotice[] };
export type InvitesResponse = { invites: FamilyInvite[] };
/** The only response that carries the plain code; it is never stored or listed again. */
export type CreatedInvite = { inviteId: string; code: string; url: string; expiresAt: string };
export type FamilyResponse = { family: FamilyData | null };
export type TabsResponse = { tabs: ExpenseTab[] };
export type SavedTabResponse = { tab: ExpenseTab };

/** PATCH → {@link SavedTabResponse}; DELETE → `{ success: true }`. */
export function expenseTabApiKey(id: string) {
  return `${EXPENSE_TABS_API_KEY}/${encodeURIComponent(id)}`;
}

/** GET → `ExpenseTabLedgerData` (`@/lib/expenses/tabs`). */
export function expenseTabExpensesApiKey(id: string, filters: ExpenseTabFilters, revision?: string) {
  const params = expenseTabFilterParams(filters);
  if (revision) params.set("revision", revision);
  return `${expenseTabApiKey(id)}/expenses?${params}`;
}

/** GET → `DashboardData` (`@/lib/expenses/types`). */
export function dashboardApiKey(filters: AnalyticsFilters) {
  const params = new URLSearchParams({
    period: filters.period,
    granularity: filters.granularity,
    date: filters.customDate,
  });
  return `/api/dashboard?${params}`;
}

/** GET → `ExpensesData` (`@/lib/expenses/types`). */
export function expensesApiKey(month: string) {
  return `/api/expenses?month=${encodeURIComponent(month)}`;
}

/** GET → `ExpensesData` (`@/lib/expenses/types`). */
export function mainExpensesApiKey(month: string) {
  return `${expensesApiKey(resolveMainExpenseMonth(month))}&context=main`;
}

export function mainExpensesExportUrl(month: string) {
  return `/api/expenses/export?month=${encodeURIComponent(resolveMainExpenseMonth(month))}`;
}

/** GET → `InvestmentTransactionsResponse` (`@/lib/investments/types`). */
export function investmentTransactionsApiKey({
  accountId,
  instrument,
  currency,
}: {
  accountId: string;
  instrument: string;
  currency: string;
}) {
  const params = new URLSearchParams({ accountId, instrument, currency });
  return `/api/investment-transactions?${params}`;
}

/** PATCH only: `{ permissions }` → {@link FamilyResponse} with the updated family. Kids only; parents answer 403. */
export function familyMemberPermissionsApiUrl(memberId: string) {
  return `/api/family/members/${encodeURIComponent(memberId)}/permissions`;
}

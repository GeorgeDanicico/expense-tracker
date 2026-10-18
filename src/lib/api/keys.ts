import type { AnalyticsFilters } from "@/lib/expenses/types";
import { resolveMainExpenseMonth } from "@/lib/calendar";
import { expenseTabFilterParams, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { AccountNotice } from "@/lib/account/notice-repository";
import type { FamilyData, FamilyInvite } from "@/lib/family/repository";
import { MEMBER_PARAM } from "@/lib/family/viewing";

/**
 * Adds `?member=<memberId>` (or `&member=`) to a finance read's URL so it shows that member's data.
 * `null` or `undefined` is yourself and leaves the URL as it was, so caches of different members
 * never share a key.
 */
export function withMember(url: string, member?: string | null) {
  if (!member) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${MEMBER_PARAM}=${encodeURIComponent(member)}`;
}

// Each key notes the response type its GET returns. Types owned by a domain
// module are referenced there; wrapper shapes that only exist on the wire live here.

/** GET → `AccountData` (`@/lib/account/types`); PATCH returns the updated `AccountData`. */
export const ACCOUNT_API_KEY = "/api/account";
/** POST only: `{ password }` → 204. Not fetched with SWR; refresh `ACCOUNT_API_KEY` afterwards. */
export const ACCOUNT_PASSWORD_API_URL = "/api/account/password";
/** PUT raw JPG/PNG bytes (`Content-Type: image/jpeg|image/png`) → `{ avatarUrl }`; DELETE → 204. Refresh `ACCOUNT_API_KEY` and `FAMILY_API_KEY` afterwards. */
export const ACCOUNT_AVATAR_API_URL = "/api/account/avatar";
/** PATCH only: `{ email }` → 204. The change applies once the link sent to the new address is opened. */
export const ACCOUNT_EMAIL_API_URL = "/api/account/email";
/** GET → {@link NoticesResponse}: the unseen notices, oldest first. 404 while the family flag is off. */
export const ACCOUNT_NOTICES_API_KEY = "/api/account/notices";
/** GET → `InvestmentsOverview` (`@/lib/investments/types`). Your own data; see {@link investmentsApiKey} for a member's. */
export const INVESTMENTS_API_KEY = "/api/investments";
/** GET → `NetWorthOverview` (`@/lib/net-worth/types`). Your own data; see {@link netWorthApiKey} for a member's. */
export const NET_WORTH_API_KEY = "/api/net-worth";

/** {@link INVESTMENTS_API_KEY} for the family member `member` (yourself when `null`). */
export function investmentsApiKey(member?: string | null) {
  return withMember(INVESTMENTS_API_KEY, member);
}

/** {@link NET_WORTH_API_KEY} for the family member `member` (yourself when `null`). */
export function netWorthApiKey(member?: string | null) {
  return withMember(NET_WORTH_API_KEY, member);
}
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

/** GET → {@link TabsResponse}; POST returns {@link SavedTabResponse}. Your own tabs; see {@link expenseTabsApiKey} for a member's. */
export const EXPENSE_TABS_API_KEY = "/api/expense-tabs";

/** {@link EXPENSE_TABS_API_KEY} for the family member `member` (yourself when `null`). */
export function expenseTabsApiKey(member?: string | null) {
  return withMember(EXPENSE_TABS_API_KEY, member);
}

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
export function expenseTabExpensesApiKey(
  id: string,
  filters: ExpenseTabFilters,
  revision?: string,
  member?: string | null,
) {
  const params = expenseTabFilterParams(filters);
  if (revision) params.set("revision", revision);
  return withMember(`${expenseTabApiKey(id)}/expenses?${params}`, member);
}

/** GET → `DashboardData` (`@/lib/expenses/types`). */
export function dashboardApiKey(filters: AnalyticsFilters, member?: string | null) {
  const params = new URLSearchParams({
    period: filters.period,
    granularity: filters.granularity,
    date: filters.customDate,
  });
  return withMember(`/api/dashboard?${params}`, member);
}

/** GET → `ExpensesData` (`@/lib/expenses/types`). */
export function expensesApiKey(month: string, member?: string | null) {
  return withMember(`/api/expenses?month=${encodeURIComponent(month)}`, member);
}

/** GET → `ExpensesData` (`@/lib/expenses/types`). */
export function mainExpensesApiKey(month: string, member?: string | null) {
  return `${expensesApiKey(resolveMainExpenseMonth(month), member)}&context=main`;
}

export function mainExpensesExportUrl(month: string, member?: string | null) {
  return withMember(`/api/expenses/export?month=${encodeURIComponent(resolveMainExpenseMonth(month))}`, member);
}

/** GET → `InvestmentTransactionsResponse` (`@/lib/investments/types`). */
export function investmentTransactionsApiKey({
  accountId,
  instrument,
  currency,
  member,
}: {
  accountId: string;
  instrument: string;
  currency: string;
  member?: string | null;
}) {
  const params = new URLSearchParams({ accountId, instrument, currency });
  return withMember(`/api/investment-transactions?${params}`, member);
}

/** DELETE only → 204. The creator removes a member (never themselves). */
export function familyMemberApiUrl(memberId: string) {
  return `/api/family/members/${encodeURIComponent(memberId)}`;
}

/** PATCH only: `{ permissions }` → {@link FamilyResponse} with the updated family. Kids only; parents answer 403. */
export function familyMemberPermissionsApiUrl(memberId: string) {
  return `/api/family/members/${encodeURIComponent(memberId)}/permissions`;
}

export function familyMemberColorApiUrl(memberId: string) {
  return `/api/family/members/${encodeURIComponent(memberId)}/color`;
}

/** POST only: `{ displayName, username, password, permissions }` → {@link FamilyResponse} with the updated family (201). Parents only. */
export const FAMILY_KIDS_API_URL = "/api/family/kids";

/** POST only: `{ password }` → `{ success: true }`. A parent sets a kid's temporary password; the kid must change it at next sign-in. */
export function familyMemberPasswordApiUrl(memberId: string) {
  return `/api/family/members/${encodeURIComponent(memberId)}/password`;
}

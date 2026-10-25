import type { AnalyticsFilters } from "@/lib/expenses/types";
import { resolveMainExpenseMonth } from "@/lib/calendar";
import { expenseTabFilterParams, type ExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { AccountNotice } from "@/lib/account/notice-repository";
import type { ConnectedApp, OAuthApp } from "@/lib/auth/oauth-consent";
import type { FamilyData, FamilyInvite } from "@/lib/family/repository";
import { MEMBER_PARAM } from "@/lib/family/viewing";
import type { McpAccess, McpToken } from "@/lib/mcp/token-repository";
import type { NotificationSettings } from "@/lib/notifications/settings-repository";
import type { ReminderCompletion, ReminderSummary } from "@/lib/reminders/repository";
import type { ListedReminder } from "@/lib/reminders/list";
import type { Todo } from "@/lib/todos/types";

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

/**
 * GET → {@link OAuthAuthorizationResponse}: an OAuth app's request to use the caller's account, for
 * the consent page. 404 when it doesn't exist, has expired or is someone else's.
 */
export function oauthAuthorizationApiKey(authorizationId: string) {
  return `/api/oauth/authorizations/${encodeURIComponent(authorizationId)}`;
}

/** POST only → {@link OAuthDecisionResponse}. 403 with the reason when the caller can't use AI assistants. */
export function oauthApproveApiUrl(authorizationId: string) {
  return `${oauthAuthorizationApiKey(authorizationId)}/approve`;
}

/** POST only → {@link OAuthDecisionResponse}, whose URL carries `access_denied` back to the app. */
export function oauthDenyApiUrl(authorizationId: string) {
  return `${oauthAuthorizationApiKey(authorizationId)}/deny`;
}

/**
 * What the consent page shows: the request to answer, the URL to follow for an app the caller already
 * allowed (only while their access is `ok`), or why they can't allow any app right now.
 */
export type OAuthAuthorizationResponse =
  | { kind: "consent"; email: string; app: OAuthApp; redirectUri: string; scopes: string[] }
  | { kind: "approved"; redirectUrl: string }
  /** `app` is null when Supabase already approved the request and sent no details. */
  | { kind: "refused"; email: string; reason: Exclude<McpAccess["status"], "ok">; app: OAuthApp | null };
/** Where to send the browser next: back to the app, with a one-time code or `access_denied`. */
export type OAuthDecisionResponse = { redirectUrl: string };

/**
 * GET → {@link McpSettingsResponse}: the AI assistants switch, the caller's access, their personal
 * tokens and their connected apps. PATCH `{ enabled }` → the same shape; 403 with the reason for a kid
 * who can't turn it on.
 */
export const MCP_SETTINGS_API_KEY = "/api/account/mcp";
/**
 * POST only: `{ name, expiry }` → {@link CreatedMcpToken} (201). 403 for kids, 409 at 10 live tokens.
 * Refresh `MCP_SETTINGS_API_KEY` afterwards; never put the response in the SWR cache.
 */
export const MCP_TOKENS_API_URL = `${MCP_SETTINGS_API_KEY}/tokens`;

/** DELETE only → 204: revokes the token. 404 when it isn't the caller's or is already revoked. */
export function mcpTokenApiUrl(id: string) {
  return `${MCP_TOKENS_API_URL}/${encodeURIComponent(id)}`;
}

/** POST only: `{ expiry }` → {@link CreatedMcpToken}. 404 when it isn't the caller's or is revoked. */
export function mcpTokenRegenerateApiUrl(id: string) {
  return `${mcpTokenApiUrl(id)}/regenerate`;
}

/** GET → {@link McpAppsResponse}: the caller's connected apps. */
export const MCP_APPS_API_KEY = `${MCP_SETTINGS_API_KEY}/apps`;

/** DELETE only → 204: disconnects that one app (one registration; others with the same name stay). 404 when it isn't connected. */
export function mcpAppApiUrl(clientId: string) {
  return `${MCP_APPS_API_KEY}/${encodeURIComponent(clientId)}`;
}

export type McpSettingsResponse = {
  /** The caller's switch (`profiles.mcp_enabled`). */
  enabled: boolean;
  access: McpAccess;
  /** Null when the caller can't hold personal tokens (kids). Never carries a secret. */
  tokens: McpToken[] | null;
  /** The same app can appear once per registration; each has its own client id. */
  apps: ConnectedApp[];
};
export type McpAppsResponse = { apps: ConnectedApp[] };
/** The only response that ever carries a token's secret: shown once, never stored or listed again. */
export type CreatedMcpToken = { token: McpToken; secret: string };

/**
 * GET → {@link TodosResponse}: the family board, To do and In progress whole and Done completed at
 * or after `doneSince` (the last 30 days when absent). 404 for a caller without a family.
 * POST `{ title, status? }` → {@link TodoResponse} (201), added at the top of its column.
 */
export const TODOS_API_KEY = "/api/todos";

/** {@link TODOS_API_KEY}, reaching back to `doneSince` (an ISO timestamp) in the Done column. */
export function todosApiKey(doneSince?: string | null) {
  return doneSince ? `${TODOS_API_KEY}?doneSince=${encodeURIComponent(doneSince)}` : TODOS_API_KEY;
}

/** PATCH (any of title, notes, assigneeMemberId, dueDate) → {@link TodoResponse}; DELETE → `{ success: true }`. */
export function todoApiUrl(id: string) {
  return `${TODOS_API_KEY}/${encodeURIComponent(id)}`;
}

/** POST `{ status, beforeId, afterId }` → {@link TodoResponse}; 409 when an anchor is gone. */
export function todoMoveApiUrl(id: string) {
  return `${todoApiUrl(id)}/move`;
}

export type TodosResponse = { todos: Todo[] };
export type TodoResponse = { todo: Todo };

/**
 * GET → {@link RemindersResponse}: the caller's own reminders with their state, and the occurrences
 * marked done since `doneSince` (the last 30 days when absent), newest first.
 * POST the full reminder (`reminderSchema`) → {@link ReminderResponse} (201).
 */
export const REMINDERS_API_KEY = "/api/reminders";

/** GET → `ReminderSummary` (`@/lib/reminders/repository`): `{ due, overdue }` for the badge. */
export const REMINDERS_SUMMARY_API_KEY = `${REMINDERS_API_KEY}/summary`;

/** PATCH the FULL reminder (every field of `reminderSchema`) → {@link ReminderResponse}; DELETE → `{ success: true }`. */
export function reminderApiUrl(id: string) {
  return `${REMINDERS_API_KEY}/${encodeURIComponent(id)}`;
}

/** POST only → {@link ReminderResponse} with the next occurrence; 409 when a one-off is already done. */
export function reminderCompleteApiUrl(id: string) {
  return `${reminderApiUrl(id)}/complete`;
}

/** POST `{ kind: "hour" | "tomorrow" }` or `{ kind: "until", until }` → {@link ReminderResponse}. */
export function reminderSnoozeApiUrl(id: string) {
  return `${reminderApiUrl(id)}/snooze`;
}

export type RemindersResponse = { reminders: ListedReminder[]; completions: ReminderCompletion[] };
export type ReminderResponse = { reminder: ListedReminder };
export type RemindersSummaryResponse = ReminderSummary;

/**
 * GET → {@link NotificationSettingsResponse}: the caller's switches and device count. PATCH any of
 * `{ pushEnabled, remindersEnabled, todosEnabled }` → the same shape.
 */
export const NOTIFICATION_SETTINGS_API_KEY = "/api/notifications/settings";
/**
 * POST `PushSubscription.toJSON()` → {@link NotificationSettingsResponse} (201), registering this
 * browser; DELETE `{ endpoint }` → {@link NotificationSettingsResponse}, unregistering it.
 */
export const PUSH_SUBSCRIPTIONS_API_URL = "/api/notifications/push-subscriptions";
/** GET → {@link PushKeyResponse}; 503 while the server has no VAPID key. */
export const PUSH_KEY_API_URL = "/api/notifications/push-key";
/** POST only → {@link TestNotificationResponse}: 202 when queued, 200 with a message within the minute. */
export const TEST_NOTIFICATION_API_URL = "/api/notifications/test";

export type NotificationSettingsResponse = NotificationSettings;
export type PushKeyResponse = { publicKey: string };
export type TestNotificationResponse = { queued: true } | { queued: false; message: string };

/** What the test route says when a test was already queued within the minute. */
export const TEST_ALREADY_SENT = "A test was sent less than a minute ago. Wait a minute to send another.";

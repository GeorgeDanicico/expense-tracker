import type { ModuleKey } from "@/lib/permissions";

/**
 * The one permission list (security plan S9, audit D5): every REST route and MCP tool, with what a
 * caller needs to use it and where that is checked. src/app/api/permissions.test.ts fails until a
 * new route, method or tool is listed here, and checks each module and wrapper rule against the real
 * handlers. The layers:
 *
 * - `withPermission(module, level)` (src/lib/http/permission.ts): module checks for routes.
 * - `requirePermission(module, level)`: the same check, called by a route for one kind of request.
 * - `defineTool({ module })` (src/lib/mcp/define-tool.ts): module checks for MCP tools, always `edit`.
 * - `withParent`: the role check for the family routes whose work starts or ends outside the
 *   database (creating a kid's account, resetting its password, deleting it).
 * - SQL: role checks inside the RPC (`only parents can…`), RLS for "members of the family" and
 *   "your own rows", and the profile guards for the AI and MCP switches. Their refusals keep the
 *   RPC's own message.
 *
 * Every refusal by the wrappers and `defineTool` is a 403 with `FORBIDDEN_MESSAGE`.
 */
export type Access =
  /** No session: the route authenticates in its own way (or not at all). */
  | { access: "public"; reason: string }
  /** Any signed-in account; what it reads or changes is the caller's own (RLS). */
  | { access: "signed-in" }
  /** A family module, checked by `withPermission` before the handler runs. */
  | { access: "module"; module: ModuleKey; level: "edit" | "view" }
  /** A family module for one kind of request only, checked by the route with `requirePermission`. */
  | { access: "module-when"; module: ModuleKey; level: "edit" | "view"; when: string; body: unknown }
  /** A parent of a family, checked by `withParent`. */
  | { access: "parent" }
  /** A role or membership the database checks: the RPC refuses, or RLS hides the rows. */
  | { access: "sql"; who: "parent" | "creator" | "member" | "no family" | "kid's module"; check: string };

const signedIn = { access: "signed-in" } as const;
const expenses = { access: "module", module: "expenses", level: "edit" } as const;
const investments = { access: "module", module: "investments", level: "edit" } as const;
const netWorth = { access: "module", module: "net_worth", level: "edit" } as const;
const familyMember = (check: string) => ({ access: "sql", who: "member", check }) as const;
const parentInSql = (check: string) => ({ access: "sql", who: "parent", check }) as const;
const creatorInSql = (check: string) => ({ access: "sql", who: "creator", check }) as const;

/** Every route handler under src/app/api, as "METHOD /api/path". */
export const ROUTE_ACCESS: Record<string, Access> = {
  "GET /api/account": signedIn,
  "PATCH /api/account": signedIn,
  "DELETE /api/account": { access: "sql", who: "no family", check: "delete_my_data: not a family's creator or member, nor a managed kid account" },
  "GET /api/account/ai": signedIn,
  "PATCH /api/account/ai": { access: "sql", who: "kid's module", check: "guard_profile_ai_enabled: a kid needs `ai` to turn it on" },
  "PUT /api/account/avatar": signedIn,
  "DELETE /api/account/avatar": signedIn,
  "PATCH /api/account/email": signedIn,
  "POST /api/account/export": signedIn,
  "GET /api/account/mcp": signedIn,
  "PATCH /api/account/mcp": { access: "sql", who: "kid's module", check: "guard_profile_mcp_enabled: a kid needs `mcp` (and a real email) to turn it on" },
  "GET /api/account/mcp/apps": signedIn,
  "DELETE /api/account/mcp/apps/[clientId]": signedIn,
  "POST /api/account/mcp/tokens": { access: "sql", who: "kid's module", check: "create_mcp_token: kids can't hold personal tokens" },
  "DELETE /api/account/mcp/tokens/[id]": signedIn,
  "POST /api/account/mcp/tokens/[id]/regenerate": { access: "sql", who: "kid's module", check: "regenerate_mcp_token: kids can't hold personal tokens" },
  "GET /api/account/notices": signedIn,
  "POST /api/account/notices/[id]/dismiss": signedIn,
  "POST /api/account/password": signedIn,
  "POST /api/auth": { access: "public", reason: "Signs in: there is no session yet." },
  "DELETE /api/auth": { access: "public", reason: "Signs out whatever session the cookies carry." },
  "GET /api/auth/google": { access: "public", reason: "Starts or finishes Google sign-in." },
  // The avatars bucket's policy decides whose pictures: your own, and your family's.
  "GET /api/avatars/[userId]/[file]": signedIn,
  "GET /api/calendar/events": familyMember("RLS on calendar_events"),
  "POST /api/calendar/events": familyMember("create_calendar_events"),
  "GET /api/calendar/events/[id]": familyMember("RLS on calendar_events"),
  "PATCH /api/calendar/events/[id]": familyMember("update_calendar_events"),
  "DELETE /api/calendar/events/[id]": familyMember("RLS on calendar_events"),
  "GET /api/calendar/feed-link": familyMember("RLS on calendar_feeds"),
  "POST /api/calendar/feed-link": familyMember("create_calendar_feed"),
  "DELETE /api/calendar/feed-link": familyMember("revoke_calendar_feed"),
  "GET /api/calendar/feed/[token]": { access: "public", reason: "A calendar app fetches it with no session; the token is the credential." },
  "POST /api/client-log": { access: "public", reason: "Browser errors and Web Vitals, signed out too; a session only adds the user id." },
  "POST /api/csp-report": { access: "public", reason: "Browsers send CSP reports without credentials." },
  "GET /api/dashboard": expenses,
  "GET /api/expense-tabs": expenses,
  "POST /api/expense-tabs": expenses,
  "PATCH /api/expense-tabs/[id]": expenses,
  "DELETE /api/expense-tabs/[id]": expenses,
  "GET /api/expense-tabs/[id]/expenses": expenses,
  "GET /api/expenses": expenses,
  "POST /api/expenses": expenses,
  "DELETE /api/expenses/[id]": expenses,
  "GET /api/expenses/export": expenses,
  "GET /api/family": signedIn,
  "POST /api/family": { access: "sql", who: "no family", check: "create_family: not already in a family" },
  "DELETE /api/family": creatorInSql("delete_family"),
  "GET /api/family/invites": parentInSql("list_family_invites"),
  "POST /api/family/invites": parentInSql("create_family_invite"),
  "DELETE /api/family/invites/[id]": parentInSql("revoke_family_invite"),
  "POST /api/family/join": { access: "sql", who: "no family", check: "redeem_family_invite: not already in a family" },
  "POST /api/family/join/preview": signedIn,
  "POST /api/family/kids": { access: "parent" },
  "DELETE /api/family/members/[id]": creatorInSql("remove_family_member"),
  "DELETE /api/family/members/[id]/account": { access: "parent" },
  "PATCH /api/family/members/[id]/color": parentInSql("set_member_color"),
  "POST /api/family/members/[id]/password": { access: "parent" },
  "PATCH /api/family/members/[id]/permissions": parentInSql("set_member_permissions"),
  "GET /api/imports": expenses,
  "POST /api/imports": expenses,
  "GET /api/imports/[id]": expenses,
  "DELETE /api/imports/[id]": expenses,
  "POST /api/imports/[id]/confirm": expenses,
  "POST /api/imports/[id]/undo": expenses,
  "GET /api/investments": investments,
  "GET /api/investment-transactions": investments,
  "POST /api/investment-transactions": investments,
  "DELETE /api/investment-transactions/[id]": investments,
  "GET /api/mcp": { access: "public", reason: "The MCP endpoint: a bearer token or OAuth session, checked by the route itself." },
  "POST /api/mcp": { access: "public", reason: "The MCP endpoint: a bearer token or OAuth session, checked by the route itself." },
  "DELETE /api/mcp": { access: "public", reason: "The MCP endpoint: a bearer token or OAuth session, checked by the route itself." },
  "GET /api/net-worth": netWorth,
  "POST /api/net-worth/items": netWorth,
  "PATCH /api/net-worth/items/[id]": netWorth,
  "POST /api/net-worth/items/[id]/valuations": netWorth,
  "PATCH /api/net-worth/valuations/[id]": netWorth,
  "GET /api/notifications/push-key": signedIn,
  "POST /api/notifications/push-subscriptions": signedIn,
  "DELETE /api/notifications/push-subscriptions": signedIn,
  "GET /api/notifications/settings": signedIn,
  "PATCH /api/notifications/settings": signedIn,
  "POST /api/notifications/test": signedIn,
  "GET /api/oauth/authorizations/[id]": signedIn,
  "POST /api/oauth/authorizations/[id]/approve": { access: "sql", who: "kid's module", check: "my_mcp_access: a kid needs `mcp` and a real email" },
  "POST /api/oauth/authorizations/[id]/deny": signedIn,
  "GET /api/reminders": signedIn,
  "POST /api/reminders": signedIn,
  "PATCH /api/reminders/[id]": signedIn,
  "DELETE /api/reminders/[id]": signedIn,
  "POST /api/reminders/[id]/complete": {
    access: "module-when",
    module: "expenses",
    level: "edit",
    when: "with { logExpense: true }, which adds an expense",
    body: { logExpense: true },
  },
  "POST /api/reminders/[id]/snooze": signedIn,
  "GET /api/reminders/summary": signedIn,
  "GET /api/todos": familyMember("RLS on todos"),
  "POST /api/todos": familyMember("RLS on todos"),
  "PATCH /api/todos/[id]": familyMember("RLS on todos"),
  "DELETE /api/todos/[id]": familyMember("RLS on todos"),
  "POST /api/todos/[id]/move": familyMember("RLS on todos"),
};

/**
 * Every MCP tool and the module `defineTool` checks (at `edit`), or `null` for none. On top of this,
 * every tool needs the account's MCP access (a kid's `mcp` module and a real email), which the MCP
 * route checks when it authenticates the token or OAuth session; the to-do and calendar tools exist
 * only while the family flag is on, and act on the caller's family under RLS like their routes.
 */
export const TOOL_MODULES: Record<string, ModuleKey | null> = {
  get_account: null,
  list_expenses: "expenses",
  get_spending_summary: "expenses",
  add_expense: "expenses",
  update_expense: "expenses",
  delete_expense: "expenses",
  list_expense_tabs: "expenses",
  get_expense_tab_expenses: "expenses",
  create_expense_tab: "expenses",
  update_expense_tab: "expenses",
  delete_expense_tab: "expenses",
  get_investments: "investments",
  list_investment_transactions: "investments",
  add_investment_transaction: "investments",
  delete_investment_transaction: "investments",
  get_net_worth: "net_worth",
  add_net_worth_item: "net_worth",
  update_net_worth_item: "net_worth",
  add_net_worth_valuation: "net_worth",
  update_net_worth_valuation: "net_worth",
  list_reminders: null,
  add_reminder: null,
  complete_reminder: null,
  list_todos: null,
  add_todo: null,
  move_todo: null,
  update_todo: null,
  delete_todo: null,
  list_events: null,
  add_event: null,
  update_event: null,
  delete_event: null,
};

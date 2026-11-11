import "server-only";

import { getBucharestMonth, isValidMonth, resolveMainExpenseMonth } from "@/lib/calendar";
import { parseExpenseTabFilters } from "@/lib/expenses/filters";
import { getExpenseTabLedger, getFamilyMonthlyLedger, getMonthlyLedger } from "@/lib/expenses/service";
import type { ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import { getAuthenticatedUser } from "@/lib/auth";
import { ALL_MEMBERS, FAMILY_VIEWING, MEMBER_PARAM, resolveFamilyViewers, resolveViewedUser } from "@/lib/family/viewed-user";
import { FORBIDDEN_MESSAGE, requirePermission } from "@/lib/http/permission";
import { HttpError, notFound, parseId } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { fieldErrorsOf } from "@/lib/validation/field-errors";

/*
 * The Expenses page's reads, shared by the API routes and the page's server render (PF7; the pattern
 * is in src/lib/server-prefetch.ts). Each does the route's own checks: the `expenses` permission, then
 * `resolveViewedUser` / `resolveFamilyViewers` for `?member=`. The user and the membership come from
 * the request's memo, so the route's own check costs no second read.
 */

async function caller() {
  const [user, member] = await Promise.all([getAuthenticatedUser(), requirePermission("expenses", "edit")]);
  // Not reached: the routes and the page only call these with a session.
  if (!user) throw new HttpError(403, FORBIDDEN_MESSAGE);
  return { user, member };
}

/**
 * `GET /api/expenses`'s answer for `query` (its search params): the month's ledger of the caller, of
 * a member (`?member=<id>`, read-only) or of the whole family (`?member=all`). `context=main` brings a
 * future month back to the current one and adds `effectiveMonth`.
 */
export async function loadExpenses(query: URLSearchParams) {
  const { user, member } = await caller();
  const memberParam = query.get(MEMBER_PARAM);
  const family = memberParam === ALL_MEMBERS ? await resolveFamilyViewers(member) : null;
  const { userId, viewing } = family
    ? { userId: user.id, viewing: FAMILY_VIEWING }
    : await resolveViewedUser(memberParam, user, member);
  const requestedMonth = query.get("month") ?? "";
  const isMainLedger = query.get("context") === "main";
  const month = isMainLedger
    ? resolveMainExpenseMonth(requestedMonth)
    : isValidMonth(requestedMonth) ? requestedMonth : getBucharestMonth();

  if (family) {
    return {
      ...(await getFamilyMonthlyLedger(family, month)),
      ...(isMainLedger ? { effectiveMonth: month } : {}),
      viewing,
    };
  }

  const { expenses, total, average } = await getMonthlyLedger(userId, month);
  return {
    month,
    ...(isMainLedger ? { effectiveMonth: month } : {}),
    expenses,
    total,
    average,
    viewing,
  };
}

/** `GET /api/expense-tabs`'s answer: the saved tabs of the caller or of the member in `?member=`. */
export async function loadExpenseTabs(query: URLSearchParams) {
  const { user, member } = await caller();
  const { userId, viewing } = await resolveViewedUser(query.get(MEMBER_PARAM), user, member);
  return { tabs: await getRepositories().expenseTabs.list(userId), viewing };
}

/** `GET /api/expense-tabs/[id]/expenses`'s answer for tab `id` and `query` (the tab's filters, `revision`, `member`). */
export async function loadExpenseTabLedger(id: string, query: URLSearchParams) {
  const { user, member } = await caller();
  const { userId, viewing } = await resolveViewedUser(query.get(MEMBER_PARAM), user, member);
  const tabId = parseId(id, "Invalid tab identifier.");
  const parsed = parseExpenseTabFilters(query);
  if (!parsed.success) {
    throw new HttpError(422, "Check the expense filters and try again.", fieldErrorsOf(parsed.error));
  }
  const ledger: ExpenseTabLedgerData = await getExpenseTabLedger(userId, tabId, parsed.data) ?? notFound("Expense tab not found.");
  return { ...ledger, viewing };
}

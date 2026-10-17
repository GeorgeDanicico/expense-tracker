import Decimal from "decimal.js";

import type { ExpenseCategory } from "@/lib/expenses/categories";
import type { FamilyDashboardMember } from "@/lib/expenses/types";

// Pure shaping of the family dashboard for the charts. Every function takes the members of ONE currency:
// amounts of different currencies are never added, so callers narrow with `membersIn` first.

/** One member's slice of a bar or column. */
export type Segment = { memberId: string; name: string; total: number };

/** The currencies members spend in, the one with the largest month total first (then by code). */
export function currenciesByTotal(members: readonly FamilyDashboardMember[]): string[] {
  const totals = new Map<string, Decimal>();
  for (const member of members) {
    totals.set(member.currency, (totals.get(member.currency) ?? new Decimal(0)).plus(member.total));
  }
  return [...totals]
    .toSorted(([a, totalA], [b, totalB]) => totalB.comparedTo(totalA) || a.localeCompare(b))
    .map(([currency]) => currency);
}

/** The members who spend in `currency`. */
export function membersIn(members: readonly FamilyDashboardMember[], currency: string) {
  return members.filter((member) => member.currency === currency);
}

function segmentsOf(members: readonly FamilyDashboardMember[], totalOf: (member: FamilyDashboardMember) => number): Segment[] {
  return members.map((member) => ({ memberId: member.memberId, name: member.name, total: totalOf(member) }));
}

/** `part` as a percentage of `whole` (0 for an empty whole). */
export function percentOf(part: number, whole: number) {
  return whole ? new Decimal(part).div(whole).mul(100).toNumber() : 0;
}

/** This month's total and each member's share of it, biggest spender first. */
export function monthShares(members: readonly FamilyDashboardMember[]) {
  const total = members.reduce((sum, member) => sum.plus(member.total), new Decimal(0)).toNumber();
  const shares = segmentsOf(members, (member) => member.total)
    .map((segment) => ({ ...segment, share: percentOf(segment.total, total) }))
    .toSorted((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { total, shares };
}

/** A month with each member's spending in it, for the trend's stacked columns. */
export type TrendColumn = { key: string; segments: Segment[]; total: number };

/** Monthly columns, oldest first, one segment per member. A member without that month counts 0. */
export function trendColumns(members: readonly FamilyDashboardMember[]): TrendColumn[] {
  const keys = [...new Set(members.flatMap((member) => member.series.map((point) => point.key)))].toSorted();
  return keys.map((key) => {
    const segments = segmentsOf(members, (member) => member.series.find((point) => point.key === key)?.total ?? 0);
    return { key, segments, total: segments.reduce((sum, segment) => sum.plus(segment.total), new Decimal(0)).toNumber() };
  });
}

/** A category with each member's spending in it, for the horizontal stacked bars. */
export type CategoryBar = { category: ExpenseCategory; label: string; segments: Segment[]; total: number };

/** One bar per category, biggest total first; members who spent nothing there are left out. */
export function categoryBars(members: readonly FamilyDashboardMember[]): CategoryBar[] {
  const bars = new Map<ExpenseCategory, CategoryBar>();
  for (const member of members) {
    for (const item of member.categoryTotals) {
      if (item.total <= 0) continue;
      const bar = bars.get(item.category) ?? { category: item.category, label: item.label, segments: [], total: 0 };
      bar.segments.push({ memberId: member.memberId, name: member.name, total: item.total });
      bar.total = new Decimal(bar.total).plus(item.total).toNumber();
      bars.set(item.category, bar);
    }
  }
  return [...bars.values()].toSorted((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

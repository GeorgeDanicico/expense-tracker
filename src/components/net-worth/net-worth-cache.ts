import type { NetWorthEntry, NetWorthOverview } from "@/lib/net-worth/types";

/**
 * The overview as it will read once the item `itemId` has a value on `valuedOn`. Only the row
 * changes: a value dated before the latest observation leaves the row as it is, and the totals,
 * the change figure and the attention list (which the server works out) follow the refetch.
 */
export function withValuation(overview: NetWorthOverview | undefined, itemId: string, value: string, valuedOn: string): NetWorthOverview | undefined {
  if (!overview) return overview;
  const entry = overview.entries.find((candidate) => candidate.itemId === itemId);
  if (!entry || (entry.valuedOn && entry.valuedOn > valuedOn)) return overview;
  const valued: NetWorthEntry = { ...entry, currentValue: value, valuedOn, status: "manual" };
  return { ...overview, entries: overview.entries.map((candidate) => (candidate === entry ? valued : candidate)) };
}

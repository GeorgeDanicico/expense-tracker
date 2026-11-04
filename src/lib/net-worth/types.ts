import type { InvestmentCalculationIssue } from "@/lib/investments/types";

export const NET_WORTH_ITEM_KINDS = ["asset", "liability"] as const;
export type NetWorthItemKind = (typeof NET_WORTH_ITEM_KINDS)[number];

/**
 * The balance sheet's own categories, in the order its groups show. `automatic` ones are filled from
 * elsewhere (Investments, from the positions) and aren't offered when adding an item; any other label
 * is a custom category, shown after these. `label` names the group, `optionLabel` the choice in a form.
 */
export const NET_WORTH_CATEGORIES = [
  { key: "investments", kind: "asset", label: "Investments", automatic: true },
  { key: "cash", kind: "asset", label: "Cash" },
  { key: "property", kind: "asset", label: "Property" },
  { key: "jewelry", kind: "asset", label: "Jewelry" },
  { key: "debt", kind: "liability", label: "Debts", optionLabel: "Debt or mortgage" },
] as const satisfies readonly { key: string; kind: NetWorthItemKind; label: string; optionLabel?: string; automatic?: true }[];

/** The categories a form offers for `kind`, then "Custom category" (the value `custom`). */
export function netWorthCategoryOptions(kind: NetWorthItemKind) {
  return [
    ...NET_WORTH_CATEGORIES
      .filter((category) => category.kind === kind && !("automatic" in category))
      .map((category) => ({ value: category.key, label: "optionLabel" in category ? category.optionLabel : category.label })),
    { value: "custom", label: "Custom category" },
  ];
}

/** Where a category's group sits: its place in the table, custom ones after it. */
export function netWorthCategoryRank(category: string) {
  const index = NET_WORTH_CATEGORIES.findIndex((known) => known.key === category);
  return index === -1 ? NET_WORTH_CATEGORIES.length : index;
}

export type NetWorthEntryStatus =
  | "current"
  | "manual"
  | "missing_value"
  | "missing_quote"
  | "currency_mismatch";

export type NetWorthChangeMeaning =
  | "unrealized_gain"
  | "estimated_change"
  | "balance_change"
  | "debt_reduction";

export type NetWorthChangeTone = "positive" | "negative" | "neutral";

export type NetWorthComparison = {
  label: string;
  amount: string;
  meaning: NetWorthChangeMeaning;
  tone: NetWorthChangeTone;
};

export type NetWorthEntry = {
  id: string;
  source: "investment" | "manual";
  kind: NetWorthItemKind;
  category: string;
  name: string;
  reference: string | null;
  itemId: string | null;
  currency: string;
  purchaseAmount: string | null;
  currentValue: string | null;
  comparison: NetWorthComparison | null;
  valuedOn: string | null;
  status: NetWorthEntryStatus;
};

export type NetWorthTotal = {
  currency: string;
  assets: string;
  liabilities: string;
  knownSubtotal: string;
  netWorth: string | null;
  missingValueCount: number;
  status: "complete" | "incomplete";
};

export type NetWorthAttention = {
  id: string;
  source: "investment" | "manual";
  currency: string | null;
  entryId: string | null;
  message: string;
};

export type NetWorthOverview = {
  entries: NetWorthEntry[];
  totalsByCurrency: NetWorthTotal[];
  attention: NetWorthAttention[];
  calculationIssues: InvestmentCalculationIssue[];
};

/** One family member's balance sheet in the combined family view. */
export type FamilyNetWorthMember = {
  memberId: string;
  name: string;
  currency: string;
  overview: NetWorthOverview;
};

/**
 * The family view of net worth (`?member=all`): one overview per member, and the members' totals
 * added together per currency (never across currencies).
 */
export type FamilyNetWorthOverview = {
  members: FamilyNetWorthMember[];
  totalsByCurrency: NetWorthTotal[];
};

export type NetWorthValuation = {
  id: string;
  itemId: string;
  value: string;
  valuedOn: string;
};

export type NetWorthManualItemSource = {
  id: string;
  name: string;
  kind: NetWorthItemKind;
  category: string;
  currency: string;
  purchaseAmount: string | null;
  archivedAt: string | null;
  valuations: NetWorthValuation[];
};

export function netWorthCategoryLabel(category: string) {
  return NET_WORTH_CATEGORIES.find((known) => known.key === category)?.label ?? category
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

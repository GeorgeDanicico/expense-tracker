import type { InvestmentCalculationIssue } from "@/lib/investments/types";

export const NET_WORTH_ITEM_KINDS = ["asset", "liability"] as const;
export type NetWorthItemKind = (typeof NET_WORTH_ITEM_KINDS)[number];

export const NET_WORTH_SUGGESTED_CATEGORIES = [
  "cash",
  "property",
  "jewelry",
  "debt",
] as const;
export type NetWorthSuggestedCategory = (typeof NET_WORTH_SUGGESTED_CATEGORIES)[number];

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
  const labels: Record<string, string> = {
    cash: "Cash",
    property: "Property",
    jewelry: "Jewelry",
    debt: "Debts",
    investments: "Investments",
  };

  return labels[category] ?? category
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

import Decimal from "decimal.js";

import type { InvestmentOverviewAsset, InvestmentsOverview } from "@/lib/investments/types";
import {
  type NetWorthAttention,
  type NetWorthComparison,
  type NetWorthEntry,
  type NetWorthManualItemSource,
  type NetWorthOverview,
  type NetWorthTotal,
} from "@/lib/net-worth/types";

const NetWorthDecimal = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_HALF_UP,
});

export const NET_WORTH_DECIMAL_PLACES = 10;

export function formatNetWorthDecimal(value: string | number | InstanceType<typeof NetWorthDecimal>) {
  const rounded = new NetWorthDecimal(value).toDecimalPlaces(
    NET_WORTH_DECIMAL_PLACES,
    NetWorthDecimal.ROUND_HALF_UP,
  );

  if (rounded.isZero()) return "0";
  return rounded.toFixed().replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

function decimal(value: string | number) {
  return new NetWorthDecimal(value);
}

function isZeroQuantity(quantity: string) {
  try {
    return decimal(quantity).isZero();
  } catch {
    return false;
  }
}

function signedComparisonTone(value: InstanceType<typeof NetWorthDecimal>) {
  if (value.gt(0)) return "positive" as const;
  if (value.lt(0)) return "negative" as const;
  return "neutral" as const;
}

function manualComparison(item: NetWorthManualItemSource): NetWorthComparison | null {
  const latest = item.valuations[0];
  const previous = item.valuations[1];

  if (!latest) return null;

  if (item.kind === "liability") {
    if (!previous) return null;

    const amount = decimal(previous.value).minus(latest.value);
    return {
      label: amount.gt(0) ? "Debt reduced" : amount.lt(0) ? "Debt increased" : "Debt change",
      amount: formatNetWorthDecimal(amount),
      meaning: "debt_reduction",
      tone: "neutral",
    };
  }

  if (item.category === "cash") {
    if (!previous) return null;

    const amount = decimal(latest.value).minus(previous.value);
    return {
      label: "Balance change",
      amount: formatNetWorthDecimal(amount),
      meaning: "balance_change",
      tone: "neutral",
    };
  }

  if (item.purchaseAmount !== null) {
    const amount = decimal(latest.value).minus(item.purchaseAmount);
    return {
      label: "Estimated change vs purchase",
      amount: formatNetWorthDecimal(amount),
      meaning: "estimated_change",
      tone: "neutral",
    };
  }

  if (!previous) return null;

  const amount = decimal(latest.value).minus(previous.value);
  return {
    label: "Valuation change",
    amount: formatNetWorthDecimal(amount),
    meaning: "estimated_change",
    tone: "neutral",
  };
}

function manualEntry(item: NetWorthManualItemSource): NetWorthEntry {
  const latest = item.valuations[0];

  return {
    id: `manual:${item.id}`,
    source: "manual",
    kind: item.kind,
    category: item.category,
    name: item.name,
    reference: null,
    itemId: item.id,
    currency: item.currency,
    purchaseAmount: item.purchaseAmount,
    currentValue: latest?.value ?? null,
    comparison: manualComparison(item),
    valuedOn: latest?.valuedOn ?? null,
    status: latest ? "manual" : "missing_value",
  };
}

function investmentComparison(asset: InvestmentOverviewAsset): NetWorthComparison | null {
  if (asset.currentValue === null || asset.unrealizedGain === null) return null;

  const amount = decimal(asset.unrealizedGain);
  return {
    label: amount.gt(0)
      ? "Unrealized gain"
      : amount.lt(0)
        ? "Unrealized loss"
        : "No unrealized change",
    amount: formatNetWorthDecimal(amount),
    meaning: "unrealized_gain",
    tone: signedComparisonTone(amount),
  };
}

function investmentEntry(
  accountId: string,
  asset: InvestmentOverviewAsset,
): NetWorthEntry {
  return {
    id: `investment:${accountId}:${asset.instrument}:${asset.currency}`,
    source: "investment",
    kind: "asset",
    category: "investments",
    name: asset.displayName,
    reference: asset.displayName === asset.instrument ? null : asset.instrument,
    itemId: null,
    currency: asset.currency,
    purchaseAmount: null,
    currentValue: asset.currentValue,
    comparison: investmentComparison(asset),
    valuedOn: asset.priceAsOf,
    status: asset.priceStatus === "current"
      ? "current"
      : asset.priceStatus === "currency_mismatch"
        ? "currency_mismatch"
        : "missing_quote",
  };
}

function addToSubtotal(map: Map<string, InstanceType<typeof NetWorthDecimal>>, currency: string, value: string) {
  const current = map.get(currency) ?? decimal(0);
  map.set(currency, current.plus(value));
}

function totalsForEntries(
  entries: NetWorthEntry[],
  calculationIssues: InvestmentsOverview["calculationIssues"],
): NetWorthTotal[] {
  const currencies = new Set(entries.map((entry) => entry.currency));
  const issuesByCurrency = new Map<string, number>();
  let unscopedIssueCount = 0;

  for (const issue of calculationIssues ?? []) {
    if (issue.currency) {
      currencies.add(issue.currency);
      issuesByCurrency.set(issue.currency, (issuesByCurrency.get(issue.currency) ?? 0) + 1);
    } else {
      unscopedIssueCount += 1;
    }
  }

  const totals = [...currencies].sort().map((currency) => {
    const assets = new Map<string, InstanceType<typeof NetWorthDecimal>>();
    const liabilities = new Map<string, InstanceType<typeof NetWorthDecimal>>();
    let missingValueCount = issuesByCurrency.get(currency) ?? 0;

    for (const entry of entries) {
      if (entry.currency !== currency) continue;

      if (entry.currentValue === null) {
        missingValueCount += 1;
        continue;
      }

      if (entry.kind === "asset") {
        addToSubtotal(assets, currency, entry.currentValue);
      } else {
        addToSubtotal(liabilities, currency, entry.currentValue);
      }
    }

    if (unscopedIssueCount > 0 && entries.some((entry) => entry.source === "investment")) {
      missingValueCount += unscopedIssueCount;
    }

    const assetTotal = assets.get(currency) ?? decimal(0);
    const liabilityTotal = liabilities.get(currency) ?? decimal(0);
    const knownSubtotal = assetTotal.minus(liabilityTotal);

    return {
      currency,
      assets: formatNetWorthDecimal(assetTotal),
      liabilities: formatNetWorthDecimal(liabilityTotal),
      knownSubtotal: formatNetWorthDecimal(knownSubtotal),
      netWorth: missingValueCount === 0 ? formatNetWorthDecimal(knownSubtotal) : null,
      missingValueCount,
      status: missingValueCount === 0 ? "complete" : "incomplete",
    } satisfies NetWorthTotal;
  });

  return totals;
}

function attentionForEntry(entry: NetWorthEntry): NetWorthAttention | null {
  if (entry.status === "missing_value") {
    return {
      id: `${entry.id}:missing-value`,
      source: entry.source,
      currency: entry.currency,
      entryId: entry.id,
      message: `${entry.name} needs an initial or current value.`,
    };
  }

  if (entry.status === "missing_quote") {
    return {
      id: `${entry.id}:missing-quote`,
      source: entry.source,
      currency: entry.currency,
      entryId: entry.id,
      message: `${entry.name} has no current market quote.`,
    };
  }

  if (entry.status === "currency_mismatch") {
    return {
      id: `${entry.id}:currency-mismatch`,
      source: entry.source,
      currency: entry.currency,
      entryId: entry.id,
      message: `${entry.name} has a quote in a different currency.`,
    };
  }

  return null;
}

export function buildNetWorthOverview(
  investments: InvestmentsOverview,
  manualItems: NetWorthManualItemSource[],
): NetWorthOverview {
  const entries: NetWorthEntry[] = [];

  for (const broker of investments.brokers) {
    for (const asset of broker.assets) {
      if (isZeroQuantity(asset.quantity)) continue;
      entries.push(investmentEntry(broker.accountId, asset));
    }
  }

  entries.push(...manualItems.filter((item) => !item.archivedAt).map(manualEntry));

  const attention = entries
    .map(attentionForEntry)
    .filter((item): item is NetWorthAttention => item !== null);

  for (const issue of investments.calculationIssues ?? []) {
    attention.push({
      id: `investment-issue:${issue.transactionId ?? issue.accountId}:${issue.code}`,
      source: "investment",
      currency: issue.currency,
      entryId: null,
      message: `${issue.instrument ? `${issue.instrument}: ` : ""}${issue.message}`,
    });
  }

  return {
    entries,
    totalsByCurrency: totalsForEntries(entries, investments.calculationIssues),
    attention,
    calculationIssues: investments.calculationIssues ?? [],
  };
}

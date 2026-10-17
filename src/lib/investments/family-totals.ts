import Decimal from "decimal.js";

import { formatInvestmentDecimal } from "@/lib/investments/aggregate";
import type { FamilyInvestmentsOverview, InvestmentCurrency } from "@/lib/investments/types";

export type FamilyInvestmentTotal = {
  currency: InvestmentCurrency;
  currentValue: string | null;
  remainingCost: string;
  unrealizedGain: string | null;
};

/**
 * The family's totals per currency. Cost basis always adds up. A value or gain is reported only when
 * every contributing total has one, so a missing quote never makes the family look poorer than it is.
 */
export function familyInvestmentTotals({ members }: FamilyInvestmentsOverview): FamilyInvestmentTotal[] {
  const sums = new Map<InvestmentCurrency, { cost: Decimal; value: Decimal | null; gain: Decimal | null }>();

  for (const { overview } of members) {
    for (const broker of overview.brokers) {
      for (const total of broker.totalsByCurrency) {
        const sum = sums.get(total.currency);
        const value = total.currentValue === null ? null : new Decimal(total.currentValue);
        const gain = total.unrealizedGain === null ? null : new Decimal(total.unrealizedGain);
        if (!sum) {
          sums.set(total.currency, { cost: new Decimal(total.remainingCost), value, gain });
          continue;
        }
        sum.cost = sum.cost.plus(total.remainingCost);
        sum.value = sum.value && value ? sum.value.plus(value) : null;
        sum.gain = sum.gain && gain ? sum.gain.plus(gain) : null;
      }
    }
  }

  return [...sums.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, sum]) => ({
      currency,
      remainingCost: formatInvestmentDecimal(sum.cost),
      currentValue: sum.value ? formatInvestmentDecimal(sum.value) : null,
      unrealizedGain: sum.gain ? formatInvestmentDecimal(sum.gain) : null,
    }));
}

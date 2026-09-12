import Decimal from "decimal.js";

import { formatInvestmentDecimal } from "@/lib/investments/aggregate";
import type {
  InvestmentBrokerAggregate,
  InvestmentOverviewAsset,
  InvestmentsAggregate,
  InvestmentsOverview,
} from "@/lib/investments/types";
import type { Quote } from "@/lib/investments/quotes/types";

function unavailableAsset(
  asset: InvestmentBrokerAggregate["assets"][number],
  quote: Quote | undefined,
): InvestmentOverviewAsset {
  return {
    instrument: asset.instrument,
    displayName: quote?.displayName ?? asset.instrument,
    currency: asset.currency,
    quantity: asset.quantity,
    remainingCost: asset.remainingCost,
    averageCost: asset.averageCost,
    realizedGain: asset.realizedGain,
    currentPrice: null,
    currentValue: null,
    unrealizedGain: null,
    priceAsOf: quote?.asOf ?? null,
    priceStatus: quote ? "currency_mismatch" : "unavailable",
    priceSource: quote?.source ?? null,
  };
}

function valueAsset(
  asset: InvestmentBrokerAggregate["assets"][number],
  quote: Quote,
): InvestmentOverviewAsset {
  if (quote.currency !== asset.currency) return unavailableAsset(asset, quote);

  try {
    const currentValue = new Decimal(asset.quantity).times(quote.price);
    if (!currentValue.isFinite()) return unavailableAsset(asset, quote);

    return {
      instrument: asset.instrument,
      displayName: quote.displayName ?? asset.instrument,
      currency: asset.currency,
      quantity: asset.quantity,
      remainingCost: asset.remainingCost,
      averageCost: asset.averageCost,
      realizedGain: asset.realizedGain,
      currentPrice: quote.price,
      currentValue: formatInvestmentDecimal(currentValue),
      unrealizedGain: formatInvestmentDecimal(currentValue.minus(asset.remainingCost)),
      priceAsOf: quote.asOf,
      priceStatus: "current",
      priceSource: quote.source,
    };
  } catch {
    return unavailableAsset(asset, quote);
  }
}

function mergeBrokerQuotes(
  broker: InvestmentBrokerAggregate,
  quotes: Map<string, Quote>,
) {
  const assets = broker.assets.map((asset) => {
    const quote = quotes.get(asset.instrument);
    return quote ? valueAsset(asset, quote) : unavailableAsset(asset, undefined);
  });
  const assetByCurrency = new Map<string, InvestmentOverviewAsset[]>();

  for (const asset of assets) {
    const currencyAssets = assetByCurrency.get(asset.currency);
    if (currencyAssets) {
      currencyAssets.push(asset);
    } else {
      assetByCurrency.set(asset.currency, [asset]);
    }
  }

  return {
    accountId: broker.accountId,
    brokerId: broker.brokerId,
    assets,
    totalsByCurrency: broker.totalsByCurrency.map((subtotal) => {
      const currencyAssets = assetByCurrency.get(subtotal.currency) ?? [];
      const hasCompleteQuotes = currencyAssets.length > 0
        && currencyAssets.every((asset) => asset.priceStatus === "current");

      if (!hasCompleteQuotes) {
        return {
          currency: subtotal.currency,
          remainingCost: subtotal.remainingCost,
          currentValue: null,
          unrealizedGain: null,
        };
      }

      const currentValue = currencyAssets.reduce(
        (total, asset) => total.plus(asset.currentValue ?? 0),
        new Decimal(0),
      );
      const unrealizedGain = currencyAssets.reduce(
        (total, asset) => total.plus(asset.unrealizedGain ?? 0),
        new Decimal(0),
      );

      return {
        currency: subtotal.currency,
        remainingCost: subtotal.remainingCost,
        currentValue: formatInvestmentDecimal(currentValue),
        unrealizedGain: formatInvestmentDecimal(unrealizedGain),
      };
    }),
  };
}

export function mergeInvestmentQuotes(
  aggregate: InvestmentsAggregate,
  quotes: Map<string, Quote>,
): InvestmentsOverview {
  return {
    brokers: aggregate.brokers.map((broker) => mergeBrokerQuotes(broker, quotes)),
    calculationIssues: aggregate.issues,
  };
}

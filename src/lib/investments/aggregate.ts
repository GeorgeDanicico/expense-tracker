import Decimal from "decimal.js";

import {
  INVESTMENT_BROKER_IDS,
  type InvestmentAccount,
  type InvestmentBrokerAggregate,
  type InvestmentCalculationIssue,
  type InvestmentCurrencySubtotal,
  type InvestmentPosition,
  type InvestmentTransaction,
  type InvestmentsAggregate,
} from "@/lib/investments/types";

const CalculationDecimal = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
});

/** Values use the same fractional scale as the investment database columns. */
export const INVESTMENT_DECIMAL_PLACES = 10;

export function formatInvestmentDecimal(value: InstanceType<typeof CalculationDecimal>) {
  const rounded = value.toDecimalPlaces(
    INVESTMENT_DECIMAL_PLACES,
    CalculationDecimal.ROUND_HALF_UP,
  );

  if (rounded.isZero()) return "0";

  return rounded.toFixed().replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

function groupKey(transaction: InvestmentTransaction) {
  return [
    transaction.investmentAccountId,
    transaction.instrument,
    transaction.currency,
  ].join("\u0000");
}

function issueFromError(error: InvestmentCalculationError): InvestmentCalculationIssue {
  return error.issue;
}

function parsePositiveDecimal(
  value: string,
  field: string,
  transaction: InvestmentTransaction,
) {
  try {
    const parsed = new CalculationDecimal(value);
    if (!parsed.isFinite() || !parsed.gt(0)) throw new Error("not positive");
    return parsed;
  } catch {
    throw new InvestmentCalculationError({
      code: "invalid_transaction",
      accountId: transaction.investmentAccountId,
      instrument: transaction.instrument,
      currency: transaction.currency,
      transactionId: transaction.id,
      message: `${field} must be a finite positive decimal.`,
    });
  }
}

function validateTransactionDate(transaction: InvestmentTransaction) {
  if (Number.isNaN(Date.parse(transaction.executedAt))) {
    throw new InvestmentCalculationError({
      code: "invalid_transaction",
      accountId: transaction.investmentAccountId,
      instrument: transaction.instrument,
      currency: transaction.currency,
      transactionId: transaction.id,
      message: "executedAt must be a valid timestamp.",
    });
  }
}

function compareTransactions(left: InvestmentTransaction, right: InvestmentTransaction) {
  const dateComparison = Date.parse(left.executedAt) - Date.parse(right.executedAt);
  return dateComparison || compareText(left.id, right.id);
}

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

export class InvestmentCalculationError extends Error {
  readonly issue: InvestmentCalculationIssue;

  constructor(issue: InvestmentCalculationIssue) {
    super(issue.message);
    this.name = "InvestmentCalculationError";
    this.issue = issue;
  }
}

export function calculateInvestmentPosition(
  transactions: InvestmentTransaction[],
): Omit<InvestmentPosition, "accountId" | "brokerId"> {
  if (transactions.length === 0) {
    return {
      instrument: "",
      currency: "",
      quantity: "0",
      remainingCost: "0",
      averageCost: null,
      realizedGain: "0",
      transactionCount: 0,
    };
  }

  const [firstTransaction] = transactions;
  const orderedTransactions = [...transactions].sort(compareTransactions);

  for (const transaction of orderedTransactions) {
    validateTransactionDate(transaction);

    if (
      transaction.investmentAccountId !== firstTransaction.investmentAccountId
      || transaction.instrument !== firstTransaction.instrument
      || transaction.currency !== firstTransaction.currency
    ) {
      throw new InvestmentCalculationError({
        code: "invalid_transaction",
        accountId: transaction.investmentAccountId,
        instrument: transaction.instrument,
        currency: transaction.currency,
        transactionId: transaction.id,
        message: "A calculation group must contain one account, instrument and currency.",
      });
    }

    parsePositiveDecimal(transaction.amount, "amount", transaction);
    parsePositiveDecimal(transaction.quantity, "quantity", transaction);
    parsePositiveDecimal(transaction.unitPrice, "unitPrice", transaction);
  }

  let quantity = new CalculationDecimal(0);
  let remainingCost = new CalculationDecimal(0);
  let realizedGain = new CalculationDecimal(0);

  for (const transaction of orderedTransactions) {
    const amount = new CalculationDecimal(transaction.amount);
    const transactionQuantity = new CalculationDecimal(transaction.quantity);

    if (transaction.side === "buy") {
      quantity = quantity.plus(transactionQuantity);
      remainingCost = remainingCost.plus(amount);
      continue;
    }

    if (transactionQuantity.gt(quantity)) {
      throw new InvestmentCalculationError({
        code: "oversell",
        accountId: transaction.investmentAccountId,
        instrument: transaction.instrument,
        currency: transaction.currency,
        transactionId: transaction.id,
        message: `Sell quantity exceeds the available ${transaction.instrument} position.`,
      });
    }

    const averageCost = remainingCost.div(quantity);
    const removedCost = averageCost.times(transactionQuantity);
    quantity = quantity.minus(transactionQuantity);
    remainingCost = remainingCost.minus(removedCost);
    realizedGain = realizedGain.plus(amount.minus(removedCost));
  }

  return {
    instrument: firstTransaction.instrument,
    currency: firstTransaction.currency,
    quantity: formatInvestmentDecimal(quantity),
    remainingCost: formatInvestmentDecimal(remainingCost),
    averageCost: quantity.isZero() ? null : formatInvestmentDecimal(remainingCost.div(quantity)),
    realizedGain: formatInvestmentDecimal(realizedGain),
    transactionCount: orderedTransactions.length,
  };
}

function sortBrokerAggregates(left: InvestmentBrokerAggregate, right: InvestmentBrokerAggregate) {
  return (INVESTMENT_BROKER_IDS.indexOf(left.brokerId)
    - INVESTMENT_BROKER_IDS.indexOf(right.brokerId)) || compareText(left.accountId, right.accountId);
}

export function aggregateInvestments(
  accounts: InvestmentAccount[],
  transactions: InvestmentTransaction[],
): InvestmentsAggregate {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const groups = new Map<string, InvestmentTransaction[]>();
  const issues: InvestmentCalculationIssue[] = [];

  for (const transaction of transactions) {
    if (!accountsById.has(transaction.investmentAccountId)) {
      issues.push({
        code: "unknown_account",
        accountId: transaction.investmentAccountId,
        instrument: transaction.instrument,
        currency: transaction.currency,
        transactionId: transaction.id,
        message: "The transaction references an unknown investment account.",
      });
      continue;
    }

    const key = groupKey(transaction);
    const group = groups.get(key);
    if (group) {
      group.push(transaction);
    } else {
      groups.set(key, [transaction]);
    }
  }

  const brokerMap = new Map<string, InvestmentBrokerAggregate>();

  for (const group of groups.values()) {
    const account = accountsById.get(group[0].investmentAccountId);
    if (!account) continue;

    let position: Omit<InvestmentPosition, "accountId" | "brokerId">;
    try {
      position = calculateInvestmentPosition(group);
    } catch (error) {
      if (error instanceof InvestmentCalculationError) {
        issues.push(issueFromError(error));
        continue;
      }
      throw error;
    }

    const broker = brokerMap.get(account.id);
    const asset: InvestmentPosition = {
      accountId: account.id,
      brokerId: account.brokerId,
      ...position,
    };

    if (broker) {
      broker.assets.push(asset);
      continue;
    }

    brokerMap.set(account.id, {
      accountId: account.id,
      brokerId: account.brokerId,
      totalsByCurrency: [],
      assets: [asset],
    });
  }

  const brokers = [...brokerMap.values()]
    .map((broker) => {
      const subtotalMap = new Map<string, InvestmentCurrencySubtotal>();

      for (const asset of broker.assets) {
        const subtotal = subtotalMap.get(asset.currency);
        if (subtotal) {
          subtotal.remainingCost = formatInvestmentDecimal(
            new CalculationDecimal(subtotal.remainingCost).plus(asset.remainingCost),
          );
          subtotal.realizedGain = formatInvestmentDecimal(
            new CalculationDecimal(subtotal.realizedGain).plus(asset.realizedGain),
          );
        } else {
          subtotalMap.set(asset.currency, {
            currency: asset.currency,
            remainingCost: asset.remainingCost,
            realizedGain: asset.realizedGain,
          });
        }
      }

      return {
        ...broker,
        assets: [...broker.assets].sort(
          (left, right) => compareText(left.instrument, right.instrument)
            || compareText(left.currency, right.currency),
        ),
        totalsByCurrency: [...subtotalMap.values()].sort((left, right) =>
          compareText(left.currency, right.currency),
        ),
      };
    })
    .sort(sortBrokerAggregates);

  return { brokers, issues };
}

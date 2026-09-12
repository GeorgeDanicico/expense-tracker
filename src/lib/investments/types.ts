export const INVESTMENT_BROKER_IDS = ["xtb", "banca_transilvania"] as const;
export type InvestmentBrokerId = (typeof INVESTMENT_BROKER_IDS)[number];

export function isInvestmentBrokerId(value: string): value is InvestmentBrokerId {
  return INVESTMENT_BROKER_IDS.includes(value as InvestmentBrokerId);
}

export const INVESTMENT_BROKER_LABELS: Record<InvestmentBrokerId, string> = {
  xtb: "XTB",
  banca_transilvania: "Banca Transilvania",
};

export const INVESTMENT_TRANSACTION_SIDES = ["buy", "sell"] as const;
export type InvestmentTransactionSide = (typeof INVESTMENT_TRANSACTION_SIDES)[number];

/**
 * Investment currencies are validated as uppercase ISO-style three-letter
 * codes. The initial examples are EUR, USD and RON, but the contract remains
 * open to other quoted currencies without a schema change.
 */
export type InvestmentCurrency = string;

export const INVESTMENT_CURRENCY_EXAMPLES = ["EUR", "USD", "RON"] as const;

export function isInvestmentCurrency(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

export type InvestmentAccount = {
  id: string;
  brokerId: InvestmentBrokerId;
};

/** Raw transaction DTO. Financial values stay strings at system boundaries. */
export type InvestmentTransaction = {
  id: string;
  investmentAccountId: string;
  instrument: string;
  currency: InvestmentCurrency;
  side: InvestmentTransactionSide;
  amount: string;
  quantity: string;
  unitPrice: string;
  executedAt: string;
};

export type InvestmentTransactionInput = {
  brokerId: InvestmentBrokerId;
  instrument: string;
  currency: InvestmentCurrency;
  side: InvestmentTransactionSide;
  amount: string;
  quantity: string;
  unitPrice: string;
  executedAt: string;
};

export type InvestmentPosition = {
  accountId: string;
  brokerId: InvestmentBrokerId;
  instrument: string;
  currency: InvestmentCurrency;
  quantity: string;
  remainingCost: string;
  averageCost: string | null;
  realizedGain: string;
  transactionCount: number;
};

export type InvestmentCurrencySubtotal = {
  currency: InvestmentCurrency;
  remainingCost: string;
  realizedGain: string;
};

export type InvestmentBrokerAggregate = {
  accountId: string;
  brokerId: InvestmentBrokerId;
  totalsByCurrency: InvestmentCurrencySubtotal[];
  assets: InvestmentPosition[];
};

export type InvestmentCalculationIssueCode =
  | "unknown_account"
  | "invalid_transaction"
  | "oversell";

export type InvestmentCalculationIssue = {
  code: InvestmentCalculationIssueCode;
  accountId: string;
  instrument: string | null;
  currency: InvestmentCurrency | null;
  transactionId: string | null;
  message: string;
};

export type InvestmentsAggregate = {
  brokers: InvestmentBrokerAggregate[];
  issues: InvestmentCalculationIssue[];
};

export type InvestmentOverviewAsset = {
  instrument: string;
  displayName: string;
  currency: InvestmentCurrency;
  quantity: string;
  remainingCost: string;
  averageCost: string | null;
  realizedGain: string;
  currentPrice: string | null;
  currentValue: string | null;
  unrealizedGain: string | null;
  priceAsOf: string | null;
  priceStatus: "current" | "unavailable" | "currency_mismatch";
  priceSource: "mock" | null;
};

export type InvestmentsOverview = {
  brokers: Array<{
    accountId: string;
    brokerId: InvestmentBrokerId;
    totalsByCurrency: Array<{
      currency: InvestmentCurrency;
      currentValue: string | null;
      remainingCost: string;
      unrealizedGain: string | null;
    }>;
    assets: InvestmentOverviewAsset[];
  }>;
  calculationIssues?: InvestmentCalculationIssue[];
};

export type InvestmentTransactionDto = InvestmentTransaction & {
  brokerId: InvestmentBrokerId;
};

export type InvestmentTransactionsResponse = {
  accountId: string;
  instrument: string;
  currency: InvestmentCurrency;
  transactions: InvestmentTransactionDto[];
};

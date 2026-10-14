import type { ExpenseTab, ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/tab-filters";
import type {
  InvestmentsOverview,
  InvestmentTransactionsResponse,
} from "@/lib/investments/types";
import type { NetWorthOverview } from "@/lib/net-worth/types";
import { CATEGORY_LABELS, type ExpenseCategory } from "@/lib/expenses/categories";
import type {
  AccountData,
  DashboardData,
  Expense,
  ExpensesData,
} from "@/lib/types";
import { dateInMonth, daysInMonth, getProcessLocalMonth, shiftMonth } from "@/lib/calendar";

/** Deterministic sample data for the development screen preview. */
const TEMPLATE: [string, number, ExpenseCategory, string | null][] = [
  ["Weekly groceries", 86.4, "groceries", "Farmers market and supermarket"],
  ["Rent", 950, "housing", null],
  ["Fuel", 61.2, "car", null],
  ["Electricity bill", 74.35, "utilities", null],
  ["Cinema tickets", 24, "entertainment", "Two tickets"],
  ["Pharmacy", 18.9, "health", null],
  ["Train to Cluj", 42.5, "transport", null],
  ["Running shoes", 119.99, "shopping", null],
  ["Online course", 39, "education", null],
  ["Groceries top-up", 23.75, "groceries", null],
  ["Car service", 210, "car", "Annual inspection"],
  ["Weekend trip", 312.6, "travel", "Hotel, two nights"],
  ["Coffee beans", 16.5, "other", null],
  ["Internet", 29.99, "utilities", null],
];

function expensesFor(month: string, scale = 1): Expense[] {
  const days = daysInMonth(month);
  const isCurrent = month === getProcessLocalMonth();
  const lastDay = isCurrent ? new Date().getDate() : days;
  return TEMPLATE.map(([description, amount, category, notes], index) => ({
    id: `${month}-${index}`,
    description,
    amount: Math.round(amount * scale * 100) / 100,
    category,
    subtype: category === "car" ? (index === 2 ? "car_fuel" : "car_maintenance") : null,
    expenseDate: dateInMonth(month, Math.max(1, lastDay - index * 2)),
    notes,
  }));
}

function ledger(month: string, scale = 1): ExpensesData {
  const expenses = expensesFor(month, scale);
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return { month, expenses, total, average: total / expenses.length };
}

function dashboard(): DashboardData {
  const currentMonth = getProcessLocalMonth();
  const current = ledger(currentMonth);
  const months = [3, 2, 1].map((offset) => shiftMonth(currentMonth, -offset));
  const series = months.map((key, index) => ({ key, label: "", total: [1840.2, 2215.75, 1967.4][index] }));
  const totals = new Map<ExpenseCategory, number>();
  for (const expense of current.expenses) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount * 3);
  }
  const categoryTotals = [...totals].map(([category, total]) => ({
    category,
    label: CATEGORY_LABELS[category],
    total,
  })).sort((a, b) => b.total - a.total);
  const total = series.reduce((sum, item) => sum + item.total, 0);
  return {
    currentMonth,
    currentExpenses: current.expenses,
    currentTotal: current.total,
    currentCount: current.expenses.length,
    currentAverage: current.average,
    currentLargest: Math.max(...current.expenses.map((expense) => expense.amount)),
    analytics: {
      label: "Previous 3 completed months",
      total,
      count: 42,
      monthlyAverage: total / 3,
      topCategory: categoryTotals[0]?.label ?? "",
      categoryTotals,
      series,
    },
  };
}

const CAR_TAB: ExpenseTab = {
  id: "tab-car",
  name: "Car",
  categoryKeys: ["car"],
  subtypeKeys: [],
  createdAt: "2026-01-04T10:00:00.000Z",
  updatedAt: "2026-01-04T10:00:00.000Z",
};

function carLedger(): ExpenseTabLedgerData {
  const expenses = [0, 1, 2, 3].flatMap((offset) =>
    expensesFor(shiftMonth(getProcessLocalMonth(), -offset)).filter((expense) => expense.category === "car"),
  );
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return {
    tab: CAR_TAB,
    tabId: CAR_TAB.id,
    tabRevision: CAR_TAB.updatedAt,
    filters: DEFAULT_EXPENSE_TAB_FILTERS,
    expenses,
    total,
    count: expenses.length,
    average: total / expenses.length,
  };
}

const INVESTMENTS: InvestmentsOverview = {
  brokers: [
    {
      accountId: "acc-xtb",
      brokerId: "xtb",
      totalsByCurrency: [
        { currency: "EUR", currentValue: "18450.20", remainingCost: "16210.00", unrealizedGain: "2240.20" },
        { currency: "USD", currentValue: "4120.75", remainingCost: "4380.00", unrealizedGain: "-259.25" },
      ],
      assets: [
        {
          instrument: "VWCE.DE", displayName: "Vanguard FTSE All-World", currency: "EUR",
          quantity: "142", remainingCost: "16210.00", averageCost: "114.15", realizedGain: "312.40",
          currentPrice: "129.93", currentValue: "18450.20", unrealizedGain: "2240.20",
          priceAsOf: "2026-10-13T15:30:00.000Z", priceStatus: "current", priceSource: "YAHOO_FINANCE",
        },
        {
          instrument: "AAPL.US", displayName: "Apple Inc.", currency: "USD",
          quantity: "18", remainingCost: "4380.00", averageCost: "243.33", realizedGain: "0",
          currentPrice: "228.93", currentValue: "4120.75", unrealizedGain: "-259.25",
          priceAsOf: "2026-10-13T20:00:00.000Z", priceStatus: "current", priceSource: "YAHOO_FINANCE",
        },
      ],
    },
    {
      accountId: "acc-bt",
      brokerId: "banca_transilvania",
      totalsByCurrency: [{ currency: "RON", currentValue: null, remainingCost: "12500.00", unrealizedGain: null }],
      assets: [
        {
          instrument: "TLV", displayName: "Banca Transilvania", currency: "RON",
          quantity: "450", remainingCost: "12500.00", averageCost: "27.78", realizedGain: "0",
          currentPrice: null, currentValue: null, unrealizedGain: null,
          priceAsOf: null, priceStatus: "unavailable", priceSource: null,
        },
      ],
    },
  ],
};

function transactions(key: string): InvestmentTransactionsResponse {
  const params = new URLSearchParams(key.split("?")[1]);
  const instrument = params.get("instrument") ?? "VWCE.DE";
  const currency = params.get("currency") ?? "EUR";
  const accountId = params.get("accountId") ?? "acc-xtb";
  return {
    accountId,
    instrument,
    currency,
    transactions: [
      ["sell", "1300.00", "10", "130.00", "2026-09-02T09:31:00.000Z"],
      ["buy", "5800.00", "50", "116.00", "2026-03-14T08:12:00.000Z"],
      ["buy", "11710.00", "102", "114.80", "2025-11-03T10:45:00.000Z"],
    ].map(([side, amount, quantity, unitPrice, executedAt], index) => ({
      id: `tx-${index}`,
      investmentAccountId: accountId,
      brokerId: accountId === "acc-bt" ? "banca_transilvania" : "xtb",
      instrument,
      currency,
      side: side as "buy" | "sell",
      amount,
      quantity,
      unitPrice,
      executedAt,
    })),
  };
}

const NET_WORTH: NetWorthOverview = {
  entries: [
    {
      id: "e-cash", source: "manual", kind: "asset", category: "cash", name: "Savings account",
      reference: null, itemId: "i-cash", currency: "EUR", purchaseAmount: null, currentValue: "12400.00",
      comparison: { label: "Since last valuation", amount: "600.00", meaning: "balance_change", tone: "positive" },
      valuedOn: "2026-10-01", status: "manual",
    },
    {
      id: "e-flat", source: "manual", kind: "asset", category: "property", name: "Apartment",
      reference: null, itemId: "i-flat", currency: "EUR", purchaseAmount: "145000.00", currentValue: "162000.00",
      comparison: { label: "Since purchase", amount: "17000.00", meaning: "estimated_change", tone: "positive" },
      valuedOn: "2026-06-30", status: "manual",
    },
    {
      id: "e-vwce", source: "investment", kind: "asset", category: "investments", name: "Vanguard FTSE All-World",
      reference: "VWCE.DE · XTB", itemId: null, currency: "EUR", purchaseAmount: "16210.00", currentValue: "18450.20",
      comparison: { label: "Unrealized", amount: "2240.20", meaning: "unrealized_gain", tone: "positive" },
      valuedOn: "2026-10-13", status: "current",
    },
    {
      id: "e-ring", source: "manual", kind: "asset", category: "jewelry", name: "Watch",
      reference: null, itemId: "i-ring", currency: "EUR", purchaseAmount: "2400.00", currentValue: null,
      comparison: null, valuedOn: null, status: "missing_value",
    },
    {
      id: "e-loan", source: "manual", kind: "liability", category: "debt", name: "Mortgage",
      reference: null, itemId: "i-loan", currency: "EUR", purchaseAmount: "110000.00", currentValue: "96500.00",
      comparison: { label: "Since start", amount: "-13500.00", meaning: "debt_reduction", tone: "positive" },
      valuedOn: "2026-10-01", status: "manual",
    },
  ],
  totalsByCurrency: [
    {
      currency: "EUR", assets: "192850.20", liabilities: "96500.00", knownSubtotal: "96350.20",
      netWorth: null, missingValueCount: 1, status: "incomplete",
    },
  ],
  attention: [
    { id: "a-ring", source: "manual", currency: "EUR", entryId: "e-ring", message: "Watch needs a current value." },
  ],
  calculationIssues: [],
};

const ACCOUNT: AccountData = { email: "preview@example.com", currency: "EUR" };

/** Resolves an SWR key to fixture data, mirroring the API routes' shapes. */
export function fixtureFor(key: string): unknown {
  const [path, query = ""] = key.split("?");
  const params = new URLSearchParams(query);
  if (path === "/api/account") return ACCOUNT;
  if (path === "/api/dashboard") return dashboard();
  if (path === "/api/expenses") {
    const month = params.get("month") ?? getProcessLocalMonth();
    return ledger(month, month === getProcessLocalMonth() ? 1 : 0.92);
  }
  if (path === "/api/expense-tabs") return { tabs: [CAR_TAB] };
  if (path.startsWith("/api/expense-tabs/") && path.endsWith("/expenses")) return carLedger();
  if (path === "/api/investments") return INVESTMENTS;
  if (path === "/api/investment-transactions") return transactions(key);
  if (path === "/api/net-worth") return NET_WORTH;
  throw new Error(`No preview fixture for ${key}`);
}

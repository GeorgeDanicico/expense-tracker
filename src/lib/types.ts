export const EXPENSE_CATEGORIES = [
  "housing",
  "groceries",
  "transport",
  "utilities",
  "health",
  "entertainment",
  "shopping",
  "education",
  "travel",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  housing: "Housing",
  groceries: "Groceries",
  transport: "Transport",
  utilities: "Utilities",
  health: "Health",
  entertainment: "Entertainment",
  shopping: "Shopping",
  education: "Education",
  travel: "Travel",
  other: "Other",
};

export type Expense = {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  expenseDate: string;
  notes: string | null;
};

export type AnalyticsPeriod = "3m" | "6m" | "1y" | "2y" | "custom";
export type CustomGranularity = "month" | "day";

export type AnalyticsFilters = {
  period: AnalyticsPeriod;
  granularity: CustomGranularity;
  customDate: string;
};

export type Analytics = {
  label: string;
  total: number;
  count: number;
  monthlyAverage: number;
  topCategory: string;
  categoryTotals: { category: ExpenseCategory; label: string; total: number }[];
  series: { key: string; label: string; total: number }[];
};

export type DashboardData = {
  currentMonth: string;
  currentExpenses: Expense[];
  currentTotal: number;
  currentCount: number;
  currentAverage: number;
  currentLargest: number;
  analytics: Analytics;
};

export type AccountData = {
  email: string;
  currency: string;
};

export type ExpensesData = {
  month: string;
  expenses: Expense[];
  total: number;
  average: number;
};

export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export const INITIAL_ACTION_STATE: ActionState = {
  status: "idle",
  message: "",
};

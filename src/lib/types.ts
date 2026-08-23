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

export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export const INITIAL_ACTION_STATE: ActionState = {
  status: "idle",
  message: "",
};

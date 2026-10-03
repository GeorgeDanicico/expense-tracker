export const EXPENSE_CATEGORIES = [
  "housing", "groceries", "transport", "car", "utilities", "health",
  "entertainment", "shopping", "education", "travel", "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  housing: "Housing",
  groceries: "Groceries",
  transport: "Transport",
  car: "Car",
  utilities: "Utilities",
  health: "Health",
  entertainment: "Entertainment",
  shopping: "Shopping",
  education: "Education",
  travel: "Travel",
  other: "Other",
};

export const EXPENSE_SUBTYPES = ["car_maintenance", "car_fuel", "car_repairs"] as const;
export type ExpenseSubtype = (typeof EXPENSE_SUBTYPES)[number];

export const SUBTYPE_LABELS: Record<ExpenseSubtype, string> = {
  car_maintenance: "Car Maintenance",
  car_fuel: "Car Fuel",
  car_repairs: "Car Repairs",
};

export const SUBTYPE_CATEGORIES: Record<ExpenseSubtype, ExpenseCategory> = {
  car_maintenance: "car",
  car_fuel: "car",
  car_repairs: "car",
};

export function subtypesForCategory(category: ExpenseCategory): ExpenseSubtype[] {
  return EXPENSE_SUBTYPES.filter((subtype) => SUBTYPE_CATEGORIES[subtype] === category);
}

export function subtypeForCategory(
  category: ExpenseCategory,
  subtype: ExpenseSubtype | null,
): ExpenseSubtype | null {
  return subtype && SUBTYPE_CATEGORIES[subtype] === category ? subtype : null;
}

export function expenseClassificationLabel(category: ExpenseCategory, subtype: ExpenseSubtype | null) {
  return subtype ? `${CATEGORY_LABELS[category]} / ${SUBTYPE_LABELS[subtype]}` : CATEGORY_LABELS[category];
}

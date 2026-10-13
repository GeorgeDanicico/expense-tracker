import { Badge } from "@chakra-ui/react";
import type { ReactNode } from "react";

import {
  expenseClassificationLabel,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";

export type StatusTone = "positive" | "negative" | "warning" | "info" | "neutral" | "brand";

const PALETTE: Record<StatusTone, string> = {
  positive: "success",
  negative: "danger",
  warning: "warning",
  info: "info",
  neutral: "neutral",
  brand: "brand",
};

/** Small status pill coloured by `status.*` tokens. */
export function StatusBadge({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <Badge colorPalette={PALETTE[tone]} variant="subtle">
      {children}
    </Badge>
  );
}

/**
 * Expense category label. `subtle` is neutral (tables and lists); `color`
 * uses the category's own `category.<key>` tokens.
 */
export function CategoryBadge({
  category,
  subtype = null,
  tone = "subtle",
}: {
  category: ExpenseCategory;
  subtype?: ExpenseSubtype | null;
  tone?: "subtle" | "color";
}) {
  return (
    <Badge
      variant="subtle"
      colorPalette="neutral"
      bg={tone === "color" ? `category.${category}.bg` : undefined}
      color={tone === "color" ? `category.${category}.fg` : "fg.muted"}
    >
      {expenseClassificationLabel(category, subtype)}
    </Badge>
  );
}

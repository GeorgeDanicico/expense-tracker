import type { ExpenseCategory } from "@/lib/expenses/categories";

/** Muted, warm hues for the 11 expense categories (`category.<key>.fg|bg`). */
const CATEGORY_COLORS: Record<ExpenseCategory, { fg: string; bg: string }> = {
  housing: { fg: "#3E5C7A", bg: "#EBF0F5" },
  groceries: { fg: "#3F6B4E", bg: "#EAF2EC" },
  transport: { fg: "#8A5A12", bg: "#FBF1DE" },
  car: { fg: "#7A4E2A", bg: "#F6EDE4" },
  utilities: { fg: "#6E6012", bg: "#F7F3DC" },
  health: { fg: "#A33732", bg: "#F9EBE9" },
  entertainment: { fg: "#A64B32", bg: "#F5E8E1" },
  shopping: { fg: "#8E3B62", bg: "#F7EAF0" },
  education: { fg: "#2F6470", bg: "#E6F1F3" },
  travel: { fg: "#2F6B5F", bg: "#E5F2EE" },
  other: { fg: "#625F58", bg: "#F1EFE9" },
};

export const categoryTokens = Object.fromEntries(
  Object.entries(CATEGORY_COLORS).map(([key, { fg, bg }]) => [
    key,
    { fg: { value: fg }, bg: { value: bg } },
  ]),
);

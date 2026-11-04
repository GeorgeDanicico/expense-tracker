import {
  BusFront,
  Car,
  Clapperboard,
  GraduationCap,
  HeartPulse,
  House,
  Lightbulb,
  MoreHorizontal,
  Plane,
  ShoppingBag,
  ShoppingBasket,
  type LucideIcon,
} from "lucide-react";

import { IconTile } from "@/components/ui/icon-tile";
import type { ExpenseCategory } from "@/lib/expenses/categories";

export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  housing: House,
  groceries: ShoppingBasket,
  transport: BusFront,
  car: Car,
  utilities: Lightbulb,
  health: HeartPulse,
  entertainment: Clapperboard,
  shopping: ShoppingBag,
  education: GraduationCap,
  travel: Plane,
  other: MoreHorizontal,
};

/** The category's coloured tile in front of an expense row (Expenses, Home, Insights). */
export function CategoryTile({ category }: { category: ExpenseCategory }) {
  return <IconTile icon={CATEGORY_ICONS[category]} bg={`category.${category}.bg`} color={`category.${category}.fg`} />;
}

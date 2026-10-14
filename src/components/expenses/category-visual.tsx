import { Flex } from "@chakra-ui/react";
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

import { ICON, ICON_STROKE } from "@/components/ui/icon";
import type { ExpenseCategory } from "@/lib/expenses/categories";

const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
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

/** Category icon in a small neutral square, used as the leading visual in rows. */
export function CategoryVisual({ category }: { category: ExpenseCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <Flex
      boxSize="7"
      flexShrink="0"
      align="center"
      justify="center"
      borderRadius="control"
      bg="bg.muted"
      color="fg.muted"
    >
      <Icon size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </Flex>
  );
}

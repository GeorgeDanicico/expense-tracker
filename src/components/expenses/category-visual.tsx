import { Flex } from "@chakra-ui/react";
import {
  BusFront,
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

import type { ExpenseCategory } from "@/lib/types";

type CategoryStyle = {
  icon: LucideIcon;
  color: string;
  bg: string;
  badge: string;
};

export const CATEGORY_STYLES: Record<ExpenseCategory, CategoryStyle> = {
  housing: { icon: House, color: "blue.700", bg: "blue.50", badge: "blue" },
  groceries: { icon: ShoppingBasket, color: "green.700", bg: "green.50", badge: "green" },
  transport: { icon: BusFront, color: "orange.700", bg: "orange.50", badge: "orange" },
  utilities: { icon: Lightbulb, color: "yellow.700", bg: "yellow.50", badge: "yellow" },
  health: { icon: HeartPulse, color: "red.700", bg: "red.50", badge: "red" },
  entertainment: { icon: Clapperboard, color: "purple.700", bg: "purple.50", badge: "purple" },
  shopping: { icon: ShoppingBag, color: "pink.700", bg: "pink.50", badge: "pink" },
  education: { icon: GraduationCap, color: "cyan.700", bg: "cyan.50", badge: "cyan" },
  travel: { icon: Plane, color: "teal.700", bg: "teal.50", badge: "teal" },
  other: { icon: MoreHorizontal, color: "gray.700", bg: "gray.100", badge: "gray" },
};

export function CategoryVisual({ category, size = "10" }: { category: ExpenseCategory; size?: string }) {
  const style = CATEGORY_STYLES[category];
  const Icon = style.icon;

  return (
    <Flex
      width={size}
      height={size}
      flexShrink="0"
      align="center"
      justify="center"
      borderRadius="xl"
      color={style.color}
      bg={style.bg}
    >
      <Icon size={18} strokeWidth={2.1} aria-hidden="true" />
    </Flex>
  );
}

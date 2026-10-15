import {
  CreditCard,
  House,
  Scale,
  Settings2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export type NavItemConfig = { href: string; label: string; icon: LucideIcon };
export type NavSection = { label: string; items: NavItemConfig[] };

export const NAV_ITEMS = {
  home: { href: "/dashboard", label: "Home", icon: House },
  expenses: { href: "/expenses", label: "Expenses", icon: CreditCard },
  investments: { href: "/investments", label: "Investments", icon: TrendingUp },
  netWorth: { href: "/net-worth", label: "Net worth", icon: Scale },
  settings: { href: "/settings", label: "Settings", icon: Settings2 },
} satisfies Record<string, NavItemConfig>;

/**
 * Grouped destinations between Home and Settings. New modules (Family, Home…) add a section here;
 * a section only appears once it has items.
 */
export const NAV_SECTIONS: NavSection[] = [
  { label: "Finance", items: [NAV_ITEMS.expenses, NAV_ITEMS.investments, NAV_ITEMS.netWorth] },
];

/** Shown in the mobile tab bar; everything else lives in the More sheet. */
export const TAB_BAR_ITEMS = [NAV_ITEMS.home, NAV_ITEMS.expenses];

/** The More sheet's sections: each section minus the destinations the tab bar already shows. */
export const MORE_SECTIONS: NavSection[] = NAV_SECTIONS
  .map((section) => ({ ...section, items: section.items.filter((item) => !TAB_BAR_ITEMS.includes(item)) }))
  .filter((section) => section.items.length > 0);

export const MORE_ITEMS = [...MORE_SECTIONS.flatMap((section) => section.items), NAV_ITEMS.settings];

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

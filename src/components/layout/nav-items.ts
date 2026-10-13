import {
  CreditCard,
  House,
  Scale,
  Settings2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export type NavItemConfig = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS = {
  home: { href: "/dashboard", label: "Home", icon: House },
  expenses: { href: "/expenses", label: "Expenses", icon: CreditCard },
  investments: { href: "/investments", label: "Investments", icon: TrendingUp },
  netWorth: { href: "/net-worth", label: "Net worth", icon: Scale },
  settings: { href: "/settings", label: "Settings", icon: Settings2 },
} satisfies Record<string, NavItemConfig>;

/** Shown in the mobile tab bar; everything else lives in the More sheet. */
export const TAB_BAR_ITEMS = [NAV_ITEMS.home, NAV_ITEMS.expenses];
export const MORE_ITEMS = [NAV_ITEMS.investments, NAV_ITEMS.netWorth, NAV_ITEMS.settings];

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

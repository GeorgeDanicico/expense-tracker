import {
  CreditCard,
  House,
  Scale,
  Settings2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type { AccountMembership } from "@/lib/account/types";
import { can, type ModuleKey } from "@/lib/permissions";

/** `module` is the permission module a destination needs at `edit`; items without one are always shown. */
export type NavItemConfig = { href: string; label: string; icon: LucideIcon; module?: ModuleKey };
export type NavSection = { label: string; items: NavItemConfig[] };

export const NAV_ITEMS = {
  home: { href: "/dashboard", label: "Home", icon: House },
  expenses: { href: "/expenses", label: "Expenses", icon: CreditCard, module: "expenses" },
  investments: { href: "/investments", label: "Investments", icon: TrendingUp, module: "investments" },
  netWorth: { href: "/net-worth", label: "Net worth", icon: Scale, module: "net_worth" },
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

/**
 * The navigation a user can reach. `membership` is `undefined` while the account is loading, which
 * shows everything rather than flashing items in; the server and the page guards enforce access.
 * A section with no visible items disappears.
 */
export function navigationFor(membership: AccountMembership | null | undefined) {
  const reachable = (item: NavItemConfig) =>
    membership === undefined || !item.module || can(membership, item.module, "edit");
  const sections = (list: NavSection[]) =>
    list.map((section) => ({ ...section, items: section.items.filter(reachable) })).filter((section) => section.items.length > 0);
  const tabBarItems = TAB_BAR_ITEMS.filter(reachable);
  const moreSections = sections(
    NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => !TAB_BAR_ITEMS.includes(item)) })),
  );
  return {
    sections: sections(NAV_SECTIONS),
    tabBarItems,
    moreSections,
    moreItems: [...moreSections.flatMap((section) => section.items), NAV_ITEMS.settings],
  };
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

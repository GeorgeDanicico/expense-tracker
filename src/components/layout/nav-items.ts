import {
  BellRing,
  CalendarDays,
  CreditCard,
  House,
  Scale,
  Settings2,
  SquareKanban,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type { AccountMembership } from "@/lib/account/types";
import { can, type ModuleKey } from "@/lib/permissions";

/**
 * `module` is the permission module a destination needs at `edit`; `requiresFamily` hides it from a
 * user without a family (the family features: their pages only mean something inside a family).
 * Items with neither are always shown.
 */
export type NavItemConfig = {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleKey;
  requiresFamily?: boolean;
  /** A count shown next to the label (see `NavBadge`): `reminders` is what's due or overdue. */
  badge?: "reminders";
};
export type NavSection = { label: string; items: NavItemConfig[] };

export const NAV_ITEMS = {
  home: { href: "/dashboard", label: "Home", icon: House },
  expenses: { href: "/expenses", label: "Expenses", icon: CreditCard, module: "expenses" },
  investments: { href: "/investments", label: "Investments", icon: TrendingUp, module: "investments" },
  netWorth: { href: "/net-worth", label: "Net worth", icon: Scale, module: "net_worth" },
  reminders: { href: "/reminders", label: "Reminders", icon: BellRing, badge: "reminders" },
  todos: { href: "/todos", label: "To-dos", icon: SquareKanban, requiresFamily: true },
  calendar: { href: "/calendar", label: "Calendar", icon: CalendarDays, requiresFamily: true },
  settings: { href: "/settings", label: "Settings", icon: Settings2 },
} satisfies Record<string, NavItemConfig>;

/**
 * Grouped destinations between Home and Settings. New modules add a section here; a section only
 * appears once it has items. Planning holds the personal Reminders, which everyone reaches, then
 * the family-only To-dos and Calendar last, so a user without a family keeps the section with
 * Reminders alone.
 */
export const NAV_SECTIONS: NavSection[] = [
  { label: "Finance", items: [NAV_ITEMS.expenses, NAV_ITEMS.investments, NAV_ITEMS.netWorth] },
  { label: "Planning", items: [NAV_ITEMS.reminders, NAV_ITEMS.todos, NAV_ITEMS.calendar] },
];

/**
 * Shown in the mobile tab bar; everything else lives in the More sheet. Only destinations every user
 * reaches belong here (To-dos and Calendar need a family, so they would come and go), and two plus More keeps each
 * tab wide enough for its label at 320 px.
 */
export const TAB_BAR_ITEMS: NavItemConfig[] = [NAV_ITEMS.home, NAV_ITEMS.expenses];

/** The More sheet's sections: each section minus the destinations the tab bar already shows. */
export const MORE_SECTIONS: NavSection[] = NAV_SECTIONS
  .map((section) => ({ ...section, items: section.items.filter((item) => !TAB_BAR_ITEMS.includes(item)) }))
  .filter((section) => section.items.length > 0);

export const MORE_ITEMS: NavItemConfig[] = [...MORE_SECTIONS.flatMap((section) => section.items), NAV_ITEMS.settings];

/**
 * The navigation a user can reach. `membership` is `undefined` while the account is loading: module
 * items show then rather than flash in, since most users reach them. Family-only items wait for the
 * account instead (a user without a family, the common case, would otherwise see them flash in and
 * out), and sit last in the last section, so nothing above them moves. The server and the page
 * guards enforce access either way. A section with no visible items disappears.
 */
export function navigationFor(membership: AccountMembership | null | undefined) {
  const reachable = (item: NavItemConfig) => {
    if (item.requiresFamily && !membership) return false;
    return membership === undefined || !item.module || can(membership, item.module, "edit");
  };
  const sections = (list: NavSection[]) =>
    list.map((section) => ({ ...section, items: section.items.filter(reachable) })).filter((section) => section.items.length > 0);
  const tabBarItems = TAB_BAR_ITEMS.filter(reachable);
  const moreSections = sections(
    NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => !TAB_BAR_ITEMS.includes(item)) })),
  );
  const moreItems: NavItemConfig[] = [...moreSections.flatMap((section) => section.items), NAV_ITEMS.settings];
  return { sections: sections(NAV_SECTIONS), tabBarItems, moreSections, moreItems };
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

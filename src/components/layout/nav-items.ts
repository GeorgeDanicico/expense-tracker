import {
  BellRing,
  CalendarDays,
  CreditCard,
  House,
  LayoutGrid,
  MoreHorizontal,
  Scale,
  Settings2,
  SquareKanban,
  TrendingUp,
  WalletCards,
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

export type SectionKey = "home" | "money" | "planning" | "more";

/**
 * One of the five places in the bottom bar (the + sits between Money and Planning) and one group
 * in the sidebar. `href` is where its tab goes when it isn't its first item.
 */
export type NavSection = { key: SectionKey; label: string; icon: LucideIcon; items: NavItemConfig[]; href?: string };

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
 * The navigation by frequency ("How the app becomes mobile first", point 5). Money and Planning
 * switch between their pages with a segmented control; More is the settings list on a phone, so its
 * tab goes to `/more` while the sidebar links Settings directly. Planning holds the personal
 * Reminders, which everyone reaches, then the family-only To-dos and Calendar, so a user without a
 * family keeps the section with Reminders alone.
 */
export const NAV_SECTIONS: NavSection[] = [
  { key: "home", label: "Home", icon: House, items: [NAV_ITEMS.home] },
  { key: "money", label: "Money", icon: WalletCards, items: [NAV_ITEMS.expenses, NAV_ITEMS.investments, NAV_ITEMS.netWorth] },
  { key: "planning", label: "Planning", icon: LayoutGrid, items: [NAV_ITEMS.reminders, NAV_ITEMS.todos, NAV_ITEMS.calendar] },
  { key: "more", label: "More", icon: MoreHorizontal, items: [NAV_ITEMS.settings], href: "/more" },
];

/** A section as one user reaches it: its visible items, and the page its tab opens. */
export type UserSection = Omit<NavSection, "href"> & { href: string };

/**
 * The navigation a user can reach. `membership` is `undefined` while the account is loading: module
 * items show then rather than flash in, since most users reach them. Family-only items wait for the
 * account instead (a user without a family, the common case, would otherwise see them flash in and
 * out), and sit last in their section, so nothing above them moves. The server and the page
 * guards enforce access either way. A section with no visible items disappears.
 */
export function navigationFor(membership: AccountMembership | null | undefined): { sections: UserSection[] } {
  const reachable = (item: NavItemConfig) => {
    if (item.requiresFamily && !membership) return false;
    return membership === undefined || !item.module || can(membership, item.module, "edit");
  };
  const sections = NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter(reachable) }))
    .filter((section) => section.items.length > 0)
    .map((section) => ({ ...section, href: section.href ?? section.items[0].href }));
  return { sections };
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The page of `section` that `pathname` is on: `/expenses/import` is Expenses. */
export function activeItem(section: UserSection, pathname: string) {
  return section.items.find((item) => isActivePath(pathname, item.href));
}

/** The section `pathname` belongs to, if any (`/more` is More, `/settings/mcp` is More too). */
export function activeSection(sections: readonly UserSection[], pathname: string) {
  return sections.find((section) => activeItem(section, pathname) || isActivePath(pathname, section.href));
}

/** The segmented control's options for a section: its pages by URL, or none when it has one page. */
export function segmentsFor(section: UserSection) {
  return section.items.length > 1 ? section.items.map(({ href, label }) => ({ value: href, label })) : null;
}

"use client";

import { Menu, Portal } from "@chakra-ui/react";
import { Download, FileUp, MoreHorizontal, Pencil, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { ICON } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";

/** Where the statement import lives (`src/app/(app)/expenses/import`). */
const IMPORT_PAGE_HREF = "/expenses/import";

export type ExpensesMenuItem =
  | { value: "import"; label: string; icon: LucideIcon; href: string }
  | { value: "export"; label: string; icon: LucideIcon; href: string; download: true }
  | { value: "edit-tab" | "delete-tab"; label: string; icon: LucideIcon; tone?: "danger" };

/**
 * What the Expenses screen's `⋯` holds: the rare actions, behind one button (one primary action per
 * screen, and that's the +). Import only for your own expenses; export for one person's month (not
 * the family view); a saved tab's Edit and Delete only on that tab, and only your own.
 */
export function expensesMenuItems({
  readOnly,
  family,
  tab,
  exportHref,
}: {
  readOnly: boolean;
  family: boolean;
  /** The saved tab on show, or null on the month's ledger. */
  tab: { name: string } | null;
  exportHref: string;
}): ExpensesMenuItem[] {
  if (tab) {
    return readOnly
      ? []
      : [
          { value: "edit-tab", label: `Edit “${tab.name}”`, icon: Pencil },
          { value: "delete-tab", label: `Delete “${tab.name}”`, icon: Trash2, tone: "danger" },
        ];
  }
  return [
    ...(readOnly ? [] : [{ value: "import", label: "Import a statement", icon: FileUp, href: IMPORT_PAGE_HREF } as const]),
    ...(family ? [] : [{ value: "export", label: "Export this month", icon: Download, href: exportHref, download: true } as const]),
  ];
}

/** The `⋯` beside the page title; nothing when there is nothing in it. */
export function ExpensesMenu({ items, onSelect }: { items: readonly ExpensesMenuItem[]; onSelect: (value: "edit-tab" | "delete-tab") => void }) {
  if (!items.length) return null;
  return (
    <Menu.Root
      positioning={{ placement: "bottom-end" }}
      onSelect={({ value }) => {
        if (value === "edit-tab" || value === "delete-tab") onSelect(value);
      }}
    >
      <Menu.Trigger asChild>
        <IconButton aria-label="More expense actions" variant="outline">
          <MoreHorizontal size={ICON.sm} />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="52">
            {items.map((item) => {
              const content = (
                <>
                  <item.icon size={ICON.sm} aria-hidden="true" /> {item.label}
                </>
              );
              if (!("href" in item)) {
                return (
                  <Menu.Item key={item.value} value={item.value} color={item.tone === "danger" ? "fg.error" : undefined}>
                    {content}
                  </Menu.Item>
                );
              }
              return (
                <Menu.Item key={item.value} value={item.value} asChild>
                  {"download" in item ? <a href={item.href} download>{content}</a> : <Link href={item.href}>{content}</Link>}
                </Menu.Item>
              );
            })}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

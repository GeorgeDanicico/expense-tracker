"use client";

import { Flex, Link as ChakraLink } from "@chakra-ui/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AccountData } from "@/lib/account/types";

export type SettingsTab = { href: string; label: string };

/**
 * The settings tabs for this account. Account is always there; the family tabs only when the family
 * module is on, and Manage family only for parents.
 */
export function settingsTabs(account: Pick<AccountData, "features" | "membership">): SettingsTab[] {
  const tabs: SettingsTab[] = [{ href: "/settings", label: "Account" }];
  if (!account.features.family) return tabs;
  tabs.push({ href: "/settings/family", label: "Family" }, { href: "/settings/permissions", label: "My permissions" });
  if (account.membership?.role === "parent") tabs.push({ href: "/settings/family/manage", label: "Manage family" });
  return tabs;
}

/** The tab for `pathname`: the one with the longest matching href, so `/settings/family/manage` isn't "Family". */
export function activeSettingsTab(tabs: readonly SettingsTab[], pathname: string): SettingsTab | undefined {
  return tabs
    .filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Tab-style navigation shared by every settings page. It scrolls sideways on a narrow screen. */
export function SettingsNav({ tabs }: { tabs: readonly SettingsTab[] }) {
  const pathname = usePathname();
  const active = activeSettingsTab(tabs, pathname);
  return (
    <Flex
      as="nav"
      aria-label="Settings"
      gap="1"
      overflowX="auto"
      borderBottomWidth="1px"
      borderColor="border"
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
    >
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <ChakraLink
            key={tab.href}
            asChild
            flexShrink="0"
            display="flex"
            alignItems="center"
            minH="10"
            px="3"
            mb="-1px"
            borderBottomWidth="2px"
            borderColor={isActive ? "fg.accent" : "transparent"}
            textStyle="bodySm"
            fontWeight="medium"
            color={isActive ? "fg" : "fg.muted"}
            textDecoration="none"
            whiteSpace="nowrap"
            _hover={{ color: "fg", textDecoration: "none" }}
          >
            <Link href={tab.href} aria-current={isActive ? "page" : undefined}>
              {tab.label}
            </Link>
          </ChakraLink>
        );
      })}
    </Flex>
  );
}

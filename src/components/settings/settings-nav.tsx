"use client";

import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { Bell, ChevronRight, KeyRound, ShieldCheck, Sparkles, UserCog, UserRound, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { useAppPathname } from "@/components/layout/use-app-pathname";
import { GroupLabel } from "@/components/ui/group-label";
import { ICON } from "@/components/ui/icon";
import { IconTile } from "@/components/ui/icon-tile";
import { transition } from "@/components/ui/theme/motion";
import type { AccountData } from "@/lib/account/types";

export type SettingsRow = { href: string; label: string; icon: LucideIcon };
export type SettingsGroup = { label: string; rows: SettingsRow[] };

/**
 * The settings list for this account, in the order of the direction doc (Account, Family, AI).
 * Account, Notifications and the two AI pages are always there (reminders don't need a family); the
 * Family group only when the family module is on, and Manage family only for parents.
 */
export function settingsGroups(account: Pick<AccountData, "features" | "membership">): SettingsGroup[] {
  const groups: SettingsGroup[] = [
    {
      label: "Account",
      rows: [
        { href: "/settings", label: "Account", icon: UserRound },
        { href: "/settings/notifications", label: "Notifications", icon: Bell },
      ],
    },
  ];
  if (account.features.family) {
    const rows: SettingsRow[] = [
      { href: "/settings/family", label: "Family", icon: Users },
      { href: "/settings/permissions", label: "My permissions", icon: KeyRound },
    ];
    if (account.membership?.role === "parent") rows.push({ href: "/settings/family/manage", label: "Manage family", icon: UserCog });
    groups.push({ label: "Family", rows });
  }
  groups.push({
    label: "AI",
    rows: [
      { href: "/settings/mcp", label: "AI assistants", icon: ShieldCheck },
      { href: "/settings/ai", label: "AI features", icon: Sparkles },
    ],
  });
  return groups;
}

/** The row for `pathname`: the one with the longest matching href, so `/settings/family/manage` isn't "Family". */
export function activeSettingsRow(groups: readonly SettingsGroup[], pathname: string): SettingsRow | undefined {
  return groups
    .flatMap((group) => group.rows)
    .filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * The grouped list: More on a phone, the column left of the open page on desktop. The open page is
 * highlighted from `md` up only; on a phone the list is a menu and no page is open.
 */
export function SettingsList({ groups }: { groups: readonly SettingsGroup[] }) {
  const pathname = useAppPathname();
  const active = activeSettingsRow(groups, pathname);
  return (
    <Stack as="nav" aria-label="Settings" gap="4">
      {groups.map((group) => (
        <Stack key={group.label} gap="1.5">
          <GroupLabel>{group.label}</GroupLabel>
          <Box as="ul" listStyleType="none" m="0" p="0" bg="bg.surface" borderRadius="card" overflow="hidden" boxShadow="xs">
            {group.rows.map((row, index) => {
              const current = row === active;
              return (
                <Box as="li" key={row.href}>
                  <Link href={row.href} aria-current={current ? "page" : undefined}>
                    <Flex
                      align="center"
                      gap="3"
                      minH={{ base: "14", md: "12" }}
                      px="3.5"
                      borderTopWidth={index === 0 ? "0" : "1px"}
                      borderColor="border"
                      bg={current ? { md: "bg.selected" } : undefined}
                      transition={transition("background-color", "fast")}
                      _hover={{ bg: current ? { md: "bg.selected" } : "bg.subtle" }}
                      _active={{ bg: "bg.muted" }}
                    >
                      <IconTile icon={row.icon} bg="bg.muted" color={current ? { base: "fg.muted", md: "fg.accent" } : "fg.muted"} />
                      <Text as="span" flex="1" textStyle="body" fontWeight="medium">
                        {row.label}
                      </Text>
                      <ChevronRight size={ICON.sm} aria-hidden="true" />
                    </Flex>
                  </Link>
                </Box>
              );
            })}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

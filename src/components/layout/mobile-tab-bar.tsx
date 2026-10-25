"use client";

import { Box, Flex, Link as ChakraLink, Text, type SystemStyleObject } from "@chakra-ui/react";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { MoreSheet } from "@/components/layout/more-sheet";
import { NavBadge, remindersBadgeLabel } from "@/components/layout/nav-badge";
import { isActivePath } from "@/components/layout/nav-items";
import { useNavigation } from "@/components/layout/use-navigation";
import { useReminderBadge } from "@/components/reminders/use-reminder-badge";
import { ICON, ICON_STROKE } from "@/components/ui/icon";

const itemStyles = (active: boolean): SystemStyleObject => ({
  position: "relative",
  flex: "1",
  minW: "0",
  minH: "3.25rem",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5",
  color: active ? "fg.accent" : "fg.muted",
  textDecoration: "none",
  borderRadius: "control",
  _hover: { textDecoration: "none", color: active ? "fg.accent" : "fg" },
  _focusVisible: { outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "-2px" },
});

function TabLabel({ children }: { children: string }) {
  return (
    <Text fontSize="2xs" lineHeight="0.875rem" fontWeight="medium" textAlign="center" overflowWrap="anywhere">
      {children}
    </Text>
  );
}

/**
 * Fixed bottom navigation on mobile: Home, Expenses and the More sheet. A tab-bar item with a
 * badge shows it on its icon; More carries the count of the badged items it holds (Reminders), so
 * what's due is visible without opening the sheet.
 */
export function MobileTabBar({ email, avatarUrl = null }: { email: string; avatarUrl?: string | null }) {
  const pathname = usePathname();
  const { tabBarItems, moreItems } = useNavigation();
  const [open, setOpen] = useState(false);
  const moreActive = moreItems.some(({ href }) => isActivePath(pathname, href));
  const reminders = useReminderBadge();
  const remindersInMore = moreItems.some((item) => item.badge === "reminders");
  return (
    <Flex
      as="nav"
      aria-label="Primary navigation"
      position="fixed"
      bottom="0"
      insetX="0"
      zIndex="docked"
      display={{ base: "flex", md: "none" }}
      bg="bg.surface"
      borderTopWidth="1px"
      borderColor="border"
      px="2"
      pb="env(safe-area-inset-bottom)"
    >
      {tabBarItems.map(({ href, label, icon: Icon, badge }) => {
        const active = pathname === href;
        return (
          <ChakraLink key={href} asChild css={itemStyles(active)}>
            <Link href={href} aria-current={active ? "page" : undefined}>
              <Icon size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <TabLabel>{label}</TabLabel>
              {badge === "reminders" ? (
                <NavBadge dot count={reminders.count} overdue={reminders.overdue} srLabel={remindersBadgeLabel(reminders.count)} />
              ) : null}
            </Link>
          </ChakraLink>
        );
      })}
      <MoreSheet
        email={email}
        avatarUrl={avatarUrl}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Box as="button" css={itemStyles(moreActive)} aria-current={moreActive ? "page" : undefined}>
            <MoreHorizontal size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <TabLabel>More</TabLabel>
            {remindersInMore ? (
              <NavBadge
                dot
                count={reminders.count}
                overdue={reminders.overdue}
                srLabel={reminders.count > 0 ? `, ${reminders.count} ${reminders.count === 1 ? "reminder" : "reminders"} due` : ""}
              />
            ) : null}
          </Box>
        }
      />
    </Flex>
  );
}

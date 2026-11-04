"use client";

import { Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useId } from "react";

import { NavBadge, remindersBadgeLabel } from "@/components/layout/nav-badge";
import { isActivePath, type NavItemConfig, type UserSection } from "@/components/layout/nav-items";
import { useAppPathname } from "@/components/layout/use-app-pathname";
import { useReminderBadge } from "@/components/reminders/use-reminder-badge";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { transition } from "@/components/ui/theme/motion";

/**
 * A sidebar row. An item with a `badge` shows its count at the end, in the link's accessible name
 * too ("Reminders, 3 due").
 */
export function NavItem({ item }: { item: NavItemConfig }) {
  const pathname = useAppPathname();
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  const reminders = useReminderBadge(item.badge === "reminders");
  return (
    <ChakraLink
      asChild
      position="relative"
      display="flex"
      alignItems="center"
      gap="2.5"
      minH="10"
      px="2.5"
      borderRadius="control"
      textStyle="body"
      fontWeight="medium"
      color={active ? "fg.accent" : "fg.muted"}
      bg={active ? "bg.selected" : "transparent"}
      textDecoration="none"
      transition={transition("background-color, color", "fast")}
      _hover={{ bg: active ? "bg.selected" : "bg.muted", color: active ? "fg.accent" : "fg", textDecoration: "none" }}
    >
      <Link href={item.href} aria-current={active ? "page" : undefined}>
        <Icon size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />
        {item.label}
        {item.badge === "reminders" ? (
          <NavBadge count={reminders.count} overdue={reminders.overdue} srLabel={remindersBadgeLabel(reminders.count)} />
        ) : null}
      </Link>
    </ChakraLink>
  );
}

/** A labelled group of sidebar rows, such as "Money". */
export function NavSectionGroup({ section }: { section: UserSection }) {
  const labelId = useId();
  return (
    <Stack role="group" aria-labelledby={labelId} gap="0.5">
      <Text
        id={labelId}
        px="2.5"
        pt="2"
        pb="1"
        textStyle="label"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.05em"
      >
        {section.label}
      </Text>
      {section.items.map((item) => (
        <NavItem key={item.href} item={item} />
      ))}
    </Stack>
  );
}

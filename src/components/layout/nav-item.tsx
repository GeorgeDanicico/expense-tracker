"use client";

import { Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { isActivePath, type NavItemConfig, type NavSection } from "@/components/layout/nav-items";
import { ICON, ICON_STROKE } from "@/components/ui/icon";

/**
 * Sidebar / More sheet navigation row. `compact` rows are 32px (sidebar);
 * the More sheet uses 44px touch targets.
 */
export function NavItem({
  item,
  compact = false,
  onNavigate,
}: {
  item: NavItemConfig;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <ChakraLink
      asChild
      position="relative"
      display="flex"
      alignItems="center"
      gap={compact ? "2.5" : "3"}
      minH={compact ? "8" : "11"}
      px={compact ? "2.5" : "3"}
      borderRadius="control"
      textStyle={compact ? "bodySm" : "body"}
      fontWeight="medium"
      color={active ? "fg" : "fg.muted"}
      bg={active ? "bg.selected" : "transparent"}
      textDecoration="none"
      transition="background 120ms ease, color 120ms ease"
      _hover={{ bg: active ? "bg.selected" : "bg.muted", color: "fg", textDecoration: "none" }}
      _before={
        active
          ? {
              content: '""',
              position: "absolute",
              insetStart: "0",
              top: "1.5",
              bottom: "1.5",
              width: "2px",
              borderRadius: "full",
              bg: "fg.accent",
            }
          : undefined
      }
    >
      <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
        <Icon size={compact ? ICON.sm : ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />
        {item.label}
      </Link>
    </ChakraLink>
  );
}

/** A labelled group of navigation rows, such as "Finance". */
export function NavSectionGroup({
  section,
  compact = false,
  onNavigate,
}: {
  section: NavSection;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const labelId = useId();
  return (
    <Stack role="group" aria-labelledby={labelId} gap={compact ? "0.5" : "1"}>
      <Text
        id={labelId}
        px={compact ? "2.5" : "3"}
        pt="2"
        pb="1"
        textStyle="label"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        {section.label}
      </Text>
      {section.items.map((item) => (
        <NavItem key={item.href} item={item} compact={compact} onNavigate={onNavigate} />
      ))}
    </Stack>
  );
}

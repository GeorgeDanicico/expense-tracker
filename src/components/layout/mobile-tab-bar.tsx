"use client";

import { Box, Flex, Link as ChakraLink, Text, type SystemStyleObject } from "@chakra-ui/react";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { MoreSheet } from "@/components/layout/more-sheet";
import { MORE_ITEMS, TAB_BAR_ITEMS, isActivePath } from "@/components/layout/nav-items";
import { ICON, ICON_STROKE } from "@/components/ui/icon";

const itemStyles = (active: boolean): SystemStyleObject => ({
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

/** Fixed bottom navigation on mobile: Home, Expenses and the More sheet. */
export function MobileTabBar({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = MORE_ITEMS.some(({ href }) => isActivePath(pathname, href));
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
      {TAB_BAR_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <ChakraLink key={href} asChild css={itemStyles(active)}>
            <Link href={href} aria-current={active ? "page" : undefined}>
              <Icon size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <TabLabel>{label}</TabLabel>
            </Link>
          </ChakraLink>
        );
      })}
      <MoreSheet
        email={email}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Box as="button" css={itemStyles(moreActive)} aria-current={moreActive ? "page" : undefined}>
            <MoreHorizontal size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <TabLabel>More</TabLabel>
          </Box>
        }
      />
    </Flex>
  );
}

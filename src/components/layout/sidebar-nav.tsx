"use client";

import { Box, Flex, Separator, Stack, Text } from "@chakra-ui/react";

import { Brand } from "@/components/layout/brand";
import { NavItem, NavSectionGroup } from "@/components/layout/nav-item";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { useNavigation } from "@/components/layout/use-navigation";
import { SignOutIconButton } from "@/components/layout/sign-out-button";
import { Avatar } from "@/components/ui/avatar";

function AccountRow({ email, avatarUrl }: { email: string; avatarUrl: string | null }) {
  return (
    <Flex position="relative" align="center" gap="2" ps="2" pe="1" py="1.5">
      <Avatar size="xs" name={email} src={avatarUrl} />
      <Text flex="1" minW="0" textStyle="bodySm" color="fg.muted" truncate title={email}>
        {email}
      </Text>
      <SignOutIconButton />
    </Flex>
  );
}

/** Desktop sidebar: brand, Home, the grouped sections, settings and the account row. */
export function SidebarNav({ email, avatarUrl = null }: { email: string; avatarUrl?: string | null }) {
  const { sections } = useNavigation();
  return (
    <Box
      as="aside"
      aria-label="Application sidebar"
      display={{ base: "none", md: "flex" }}
      position="sticky"
      top="0"
      width="220px"
      height="100dvh"
      flexShrink="0"
      flexDirection="column"
      px="3"
      py="4"
      bg="bg.surface"
      borderRightWidth="1px"
      borderColor="border"
    >
      <Box px="2.5">
        <Brand />
      </Box>
      <Stack as="nav" aria-label="Primary navigation" gap="0.5" mt="6">
        <NavItem item={NAV_ITEMS.home} compact />
        {sections.map((section) => (
          <NavSectionGroup key={section.label} section={section} compact />
        ))}
      </Stack>
      <Stack mt="auto" gap="1">
        <NavItem item={NAV_ITEMS.settings} compact />
        <Separator />
        <AccountRow email={email} avatarUrl={avatarUrl} />
      </Stack>
    </Box>
  );
}

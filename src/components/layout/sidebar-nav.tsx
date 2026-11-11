"use client";

import { Box, Button, Flex, Separator, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { NavItem, NavSectionGroup } from "@/components/layout/nav-item";
import { useQuickAdd } from "@/components/quick-add/quick-add-provider";
import { SignOutIconButton } from "@/components/layout/sign-out-button";
import { useNavigation } from "@/components/layout/use-navigation";
import { Avatar } from "@/components/ui/avatar";
import { ICON } from "@/components/ui/icon";
import { preloadOnIntent } from "@/lib/client/preload";

function AccountRow({ signInName, avatarUrl }: { signInName: string; avatarUrl: string | null }) {
  return (
    <Flex position="relative" align="center" gap="2" ps="2" pe="1" py="1.5">
      <Avatar size="xs" name={signInName} src={avatarUrl} decorative priority />
      <Text flex="1" minW="0" textStyle="bodySm" color="fg.muted" truncate title={signInName}>
        {signInName}
      </Text>
      <SignOutIconButton />
    </Flex>
  );
}

/**
 * Desktop sidebar: brand, Add (the same quick-add sheet as the phone's +), Home, then Money,
 * Planning and More, the same groups as the bottom bar, and the account row.
 */
export function SidebarNav({ signInName, avatarUrl = null }: { signInName: string; avatarUrl?: string | null }) {
  const { sections } = useNavigation();
  const quickAdd = useQuickAdd();
  return (
    <Box
      as="aside"
      aria-label="Application sidebar"
      display={{ base: "none", md: "flex" }}
      position="sticky"
      top="0"
      width="15rem"
      height="100dvh"
      flexShrink="0"
      flexDirection="column"
      px="3.5"
      py="5"
      bg="bg.subtle"
      borderRightWidth="1px"
      borderColor="border"
    >
      <Box px="2">
        <Brand />
      </Box>
      <Button mt="5" size="md" bg="fg.accent" color="bg.surface" _hover={{ bg: "brand.fg" }} onClick={() => quickAdd.open()} {...preloadOnIntent(quickAdd.preload)}>
        <Plus size={ICON.sm} aria-hidden="true" /> Add
      </Button>
      <Stack as="nav" aria-label="Primary navigation" gap="3" mt="5" overflowY="auto">
        {sections.map((section) =>
          section.key === "home" ? <NavItem key={section.key} item={section.items[0]} /> : <NavSectionGroup key={section.key} section={section} />,
        )}
      </Stack>
      <Stack mt="auto" gap="1">
        <Separator />
        <AccountRow signInName={signInName} avatarUrl={avatarUrl} />
      </Stack>
    </Box>
  );
}

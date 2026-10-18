"use client";

import { Flex, Separator, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { NavItem, NavSectionGroup } from "@/components/layout/nav-item";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { useNavigation } from "@/components/layout/use-navigation";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { InstallInstructions } from "@/components/pwa/install-instructions";
import { AppDialog } from "@/components/ui/app-dialog";
import { Avatar } from "@/components/ui/avatar";

/** Mobile bottom sheet with secondary destinations and account actions. */
export function MoreSheet({
  email,
  avatarUrl = null,
  trigger,
  open,
  onOpenChange,
}: {
  email: string;
  avatarUrl?: string | null;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { moreSections } = useNavigation();
  return (
    <AppDialog
      title="More"
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      closeLabel="Close More"
    >
      <Stack gap="1">
        {moreSections.map((section) => (
          <NavSectionGroup key={section.label} section={section} onNavigate={() => onOpenChange(false)} />
        ))}
        <Separator my="2" />
        <NavItem item={NAV_ITEMS.settings} onNavigate={() => onOpenChange(false)} />
        <Flex px="3" align="center" gap="2">
          <Avatar size="xs" name={email} src={avatarUrl} />
          <Text flex="1" minW="0" textStyle="caption" overflowWrap="anywhere">
            {email}
          </Text>
        </Flex>
        <SignOutButton />
        <InstallInstructions />
      </Stack>
    </AppDialog>
  );
}

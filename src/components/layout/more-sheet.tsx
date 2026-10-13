"use client";

import { Separator, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { NavItem } from "@/components/layout/nav-item";
import { MORE_ITEMS } from "@/components/layout/nav-items";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { InstallInstructions } from "@/components/pwa/install-instructions";
import { AppDialog } from "@/components/ui/app-dialog";

/** Mobile bottom sheet with secondary destinations and account actions. */
export function MoreSheet({
  email,
  trigger,
  open,
  onOpenChange,
}: {
  email: string;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
        {MORE_ITEMS.map((item) => (
          <NavItem key={item.href} item={item} onNavigate={() => onOpenChange(false)} />
        ))}
        <Separator my="2" />
        <Text px="3" textStyle="caption" overflowWrap="anywhere">
          {email}
        </Text>
        <SignOutButton />
        <InstallInstructions />
      </Stack>
    </AppDialog>
  );
}

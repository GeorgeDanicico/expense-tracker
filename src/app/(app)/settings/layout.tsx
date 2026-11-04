"use client";

import { Box, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAppPathname } from "@/components/layout/use-app-pathname";
import { SettingsList, activeSettingsRow, settingsGroups } from "@/components/settings/settings-nav";
import { ICON } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { useAccount } from "@/hooks/use-account";

/**
 * Settings: on a phone each page is its own screen with a way back to More (the list); from `md` up
 * the list sits on the left of the open page.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useAppPathname();
  const { account } = useAccount();
  const groups = account ? settingsGroups(account) : [];
  // With the family module off the family pages don't exist (the list has no row for them): they
  // send you back to the account page, as do a kid's visits to Manage family.
  const hidden = account !== undefined && !groups.some((group) => group.rows.some((row) => row.href === pathname));

  useEffect(() => {
    if (hidden) router.replace("/settings");
  }, [hidden, router]);

  if (hidden) return null;

  return (
    <Grid
      templateColumns={{ base: "minmax(0, 1fr)", md: "16rem minmax(0, 1fr)", lg: "19rem minmax(0, 1fr)" }}
      gap={PAGE_SPACING.columnGap}
      alignItems="start"
    >
      <Stack display={{ base: "none", md: "flex" }} gap={PAGE_SPACING.sectionGap}>
        <Text textStyle="pageTitle">Settings</Text>
        <SettingsList groups={groups} />
      </Stack>
      <Stack gap={PAGE_SPACING.sectionGap} maxW="44rem">
        <Box display={{ md: "none" }}>
          <Link href="/more">
            <Flex align="center" gap="1" color="fg.accent" textStyle="body" fontWeight="medium" minH="11">
              <ChevronLeft size={ICON.nav} aria-hidden="true" /> More
            </Flex>
          </Link>
        </Box>
        <PageHeader title={activeSettingsRow(groups, pathname)?.label ?? "Settings"} />
        {children}
      </Stack>
    </Grid>
  );
}

"use client";

import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { SignOutButton } from "@/components/layout/sign-out-button";
import { InstallInstructions } from "@/components/pwa/install-instructions";
import { SettingsList, settingsGroups } from "@/components/settings/settings-nav";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { useAccount } from "@/hooks/use-account";
import { PHONE_QUERY } from "@/hooks/use-is-phone";

/**
 * More, the bottom bar's last tab: who you are, the settings list, install and sign out. It is a
 * phone page. Desktop has Settings in the sidebar instead, so a wider window is sent there.
 */
export default function MorePage() {
  const router = useRouter();
  const { account } = useAccount();

  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const leaveOnDesktop = () => {
      if (!query.matches) router.replace("/settings");
    };
    leaveOnDesktop();
    query.addEventListener("change", leaveOnDesktop);
    return () => query.removeEventListener("change", leaveOnDesktop);
  }, [router]);

  if (!account) return null;
  const { membership, signInName, avatarUrl } = account;
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <PageHeader title="More" />
      <Card>
        <Card.Body>
          <Flex align="center" gap="3">
            <Avatar name={signInName} src={avatarUrl} size="md" decorative />
            <Box minW="0">
              <Text textStyle="sectionTitle" overflowWrap="anywhere">
                {signInName}
              </Text>
              {membership ? (
                <Text textStyle="bodySm" color="fg.muted">
                  {membership.role === "parent" ? "Parent" : "Kid"} · {membership.familyName}
                </Text>
              ) : null}
            </Box>
          </Flex>
        </Card.Body>
      </Card>
      <SettingsList groups={settingsGroups(account)} />
      <Stack gap="1">
        <InstallInstructions />
        <SignOutButton />
      </Stack>
    </Stack>
  );
}

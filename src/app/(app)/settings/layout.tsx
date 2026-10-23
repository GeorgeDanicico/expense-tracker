"use client";

import { Stack } from "@chakra-ui/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { SettingsNav, settingsTabs } from "@/components/settings/settings-nav";
import { PageHeader } from "@/components/ui/page-header";
import { useAccount } from "@/hooks/use-account";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { account } = useAccount();
  const tabs = account ? settingsTabs(account) : [];
  // With the family module off only the account and AI assistant pages exist (exactly the tabs); the
  // family pages send you back to the account page.
  const hidden = account !== undefined && !account.features.family && !tabs.some((tab) => tab.href === pathname);

  useEffect(() => {
    if (hidden) router.replace("/settings");
  }, [hidden, router]);

  if (hidden) return null;

  return (
    <Stack maxW="780px" gap={{ base: "4", md: "5" }}>
      <PageHeader title="Settings" />
      {tabs.length > 1 ? <SettingsNav tabs={tabs} /> : null}
      {children}
    </Stack>
  );
}

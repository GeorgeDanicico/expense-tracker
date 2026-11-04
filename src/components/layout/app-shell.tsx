"use client";

import { Box, Container, Flex } from "@chakra-ui/react";

import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { QuickAddProvider } from "@/components/layout/quick-add";
import { SectionNav } from "@/components/layout/section-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { OfflineStatus } from "@/components/pwa/offline-status";
import { PAGE_SPACING } from "@/components/ui/theme/layout";

export function AppShell({
  children,
  signInName,
  avatarUrl = null,
}: {
  children: React.ReactNode;
  signInName: string;
  /** The signed-in user's picture, or `null` for their initials. */
  avatarUrl?: string | null;
}) {
  return (
    <QuickAddProvider>
      <Box minH="100dvh">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Flex maxW="1440px" minH="100dvh" mx="auto">
          <SidebarNav signInName={signInName} avatarUrl={avatarUrl} />
          <Box flex="1" minW="0">
            <Container
              as="main"
              id="main-content"
              tabIndex={-1}
              maxW="1200px"
              px={PAGE_SPACING.pageX}
              pt={{ base: "calc(0.75rem + env(safe-area-inset-top))", md: PAGE_SPACING.pageTop.md }}
              pb={{ base: "calc(7rem + env(safe-area-inset-bottom))", md: "10" }}
            >
              <OfflineStatus />
              <SectionNav />
              {children}
            </Container>
          </Box>
        </Flex>
        <MobileTabBar />
      </Box>
    </QuickAddProvider>
  );
}

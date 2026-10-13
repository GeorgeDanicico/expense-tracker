"use client";

import { Box, Container, Flex } from "@chakra-ui/react";

import { Brand } from "@/components/layout/brand";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { OfflineStatus } from "@/components/pwa/offline-status";

export function AppShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email: string;
}) {
  return (
    <Box minH="100dvh">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Flex maxW="1440px" minH="100dvh" mx="auto">
        <SidebarNav email={email} />
        <Box flex="1" minW="0">
          <Flex
            as="header"
            display={{ base: "flex", md: "none" }}
            align="center"
            h="calc(3rem + env(safe-area-inset-top))"
            px="4"
            pt="env(safe-area-inset-top)"
            bg="bg.surface"
            borderBottomWidth="1px"
            borderColor="border"
          >
            <Brand />
          </Flex>
          <Container
            as="main"
            id="main-content"
            tabIndex={-1}
            maxW="1200px"
            px={{ base: "4", md: "6" }}
            pt={{ base: "4", md: "5" }}
            pb={{ base: "calc(4.5rem + env(safe-area-inset-bottom))", md: "8" }}
          >
            <OfflineStatus />
            {children}
          </Container>
        </Box>
      </Flex>
      <MobileTabBar email={email} />
    </Box>
  );
}

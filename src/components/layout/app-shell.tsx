"use client";

import { Box, Container, Flex, Stack, Text } from "@chakra-ui/react";
import { Landmark } from "lucide-react";
import {
  DesktopNavigation,
  MobileNavigation,
  NavigationLink,
} from "@/components/layout/app-navigation";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { OfflineStatus } from "@/components/pwa/offline-status";

function Brand() {
  return (
    <Flex align="center" gap="2" minH="11">
      <Landmark size={20} color="#A64B32" aria-hidden="true" />
      <Text fontWeight="600">Simple Ledger</Text>
    </Flex>
  );
}

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
        <Box
          as="aside"
          aria-label="Application sidebar"
          display={{ base: "none", md: "flex" }}
          position="sticky"
          top="0"
          width="208px"
          height="100dvh"
          flexShrink="0"
          flexDirection="column"
          p="4"
          bg="surface"
          borderRightWidth="1px"
          borderColor="border"
        >
          <Brand />
          <Box mt="5">
            <DesktopNavigation />
          </Box>
          <Stack mt="auto" gap="2">
            <NavigationLink href="/settings" />
            <Text color="muted" fontSize="xs" overflowWrap="anywhere" px="3">
              {email}
            </Text>
            <SignOutButton />
          </Stack>
        </Box>
        <Box flex="1" minW="0">
          <Flex
            as="header"
            display={{ base: "flex", md: "none" }}
            minH="14"
            px="4"
            pt="env(safe-area-inset-top)"
            bg="surface"
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
            pt={{ base: "4", md: "6" }}
            pb={{ base: "calc(6rem + env(safe-area-inset-bottom))", md: "6" }}
          >
            <OfflineStatus />
            {children}
          </Container>
        </Box>
      </Flex>
      <MobileNavigation email={email} />
    </Box>
  );
}

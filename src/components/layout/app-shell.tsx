"use client";

import {
  Box,
  Button,
  Container,
  Flex,
  HStack,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Landmark, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";

import {
  DesktopNavigation,
  MobileNavigation,
} from "@/components/layout/app-navigation";
import { apiRequest } from "@/lib/api/client";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <HStack gap="3">
      <Flex
        width={compact ? "9" : "10"}
        height={compact ? "9" : "10"}
        align="center"
        justify="center"
        flexShrink="0"
        borderRadius="xl"
        color="white"
        bg="purple.600"
        boxShadow="0 8px 18px rgb(124 58 237 / 24%)"
      >
        <Landmark size={compact ? 19 : 21} strokeWidth={2.3} aria-hidden="true" />
      </Flex>
      <Stack gap="0">
        <Text color="gray.900" fontWeight="800" letterSpacing="-0.02em" lineHeight="1.2">
          Simple Ledger
        </Text>
        {compact ? null : (
          <Text color="gray.500" fontSize="xs">
            Money, made clear.
          </Text>
        )}
      </Stack>
    </HStack>
  );
}

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await apiRequest<{ success: true }>("/api/auth", { method: "DELETE" });
      await mutate(() => true, undefined, { revalidate: false });
      router.replace("/login");
    } catch {
      // Keep the current session visible so the user can retry safely.
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      onClick={signOut}
      loading={pending}
      width={compact ? "10" : "full"}
      minW={compact ? "10" : undefined}
      height="10"
      px={compact ? "0" : "3"}
      justifyContent={compact ? "center" : "flex-start"}
      variant="ghost"
      color="gray.500"
      borderRadius="xl"
      aria-label="Sign out"
      _hover={{ color: "red.600", bg: "red.50" }}
    >
      <LogOut size={17} aria-hidden="true" />
      {compact ? null : <Text>Sign out</Text>}
    </Button>
  );
}

export function AppShell({ children, email }: { children: React.ReactNode; email: string }) {
  const initial = (email[0] || "U").toUpperCase();

  return (
    <Box minH="100dvh">
      <Flex maxW="1600px" minH="100dvh" mx="auto">
        <Box
          as="aside"
          aria-label="Application sidebar"
          display={{ base: "none", md: "flex" }}
          position="sticky"
          top="0"
          width={{ md: "244px", xl: "268px" }}
          height="100dvh"
          flexShrink="0"
          flexDirection="column"
          px={{ md: "5", xl: "6" }}
          py="7"
          bg="whiteAlpha.900"
          borderRightWidth="1px"
          borderColor="gray.200"
          backdropFilter="blur(18px)"
        >
          <Brand />

          <Box mt="10">
            <Text px="3.5" mb="2" color="gray.400" fontSize="xs" fontWeight="800" letterSpacing="0.12em">
              WORKSPACE
            </Text>
            <DesktopNavigation />
          </Box>

          <Stack mt="auto" gap="3">
            <Flex align="center" gap="3" p="3" borderRadius="2xl" bg="gray.50" borderWidth="1px" borderColor="gray.100">
              <Flex
                width="9"
                height="9"
                flexShrink="0"
                align="center"
                justify="center"
                borderRadius="full"
                color="purple.700"
                bg="purple.100"
                fontSize="sm"
                fontWeight="800"
              >
                {initial}
              </Flex>
              <Stack minW="0" gap="0">
                <Text fontSize="sm" fontWeight="700">Personal account</Text>
                <Text color="gray.500" fontSize="xs" truncate>{email}</Text>
              </Stack>
            </Flex>
            <SignOutButton />
          </Stack>
        </Box>

        <Box flex="1" minW="0">
          <Flex
            as="header"
            display={{ base: "flex", md: "none" }}
            position="sticky"
            top="0"
            zIndex="sticky"
            minH="16"
            align="center"
            justify="space-between"
            px="4"
            pt="env(safe-area-inset-top)"
            bg="whiteAlpha.950"
            borderBottomWidth="1px"
            borderColor="gray.200"
            backdropFilter="blur(18px)"
          >
            <Brand compact />
            <SignOutButton compact />
          </Flex>

          <Container
            as="main"
            maxW="1280px"
            px={{ base: "4", sm: "6", md: "8", xl: "10" }}
            pt={{ base: "6", md: "9", xl: "11" }}
            pb={{ base: "28", md: "12" }}
          >
            {children}
          </Container>
        </Box>
      </Flex>

      <MobileNavigation />
    </Box>
  );
}

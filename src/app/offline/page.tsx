"use client";

import { Button, Center, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { CloudOff, RefreshCw } from "lucide-react";

import { Surface } from "@/components/ui/surface";

export default function OfflinePage() {
  return (
    <Center minH="100dvh" px="4" py="8">
      <Surface width="full" maxW="440px" p={{ base: "6", md: "8" }} textAlign="center">
        <Stack align="center" gap="5">
          <Flex width="16" height="16" align="center" justify="center" borderRadius="2xl" color="purple.700" bg="purple.50">
            <CloudOff size={28} aria-hidden="true" />
          </Flex>
          <Stack gap="2">
            <Heading as="h1" size="xl" letterSpacing="-0.03em">You’re offline</Heading>
            <Text color="gray.500">
              Reconnect to view or change your private ledger. Financial data is intentionally never stored in the offline cache.
            </Text>
          </Stack>
          <Button asChild colorPalette="purple" borderRadius="xl">
            <a href="/dashboard"><RefreshCw size={17} aria-hidden="true" /> Try again</a>
          </Button>
        </Stack>
      </Surface>
    </Center>
  );
}

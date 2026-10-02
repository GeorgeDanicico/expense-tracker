"use client";

import { Button, Center, Heading, Stack, Text } from "@chakra-ui/react";
import { CloudOff, RefreshCw } from "lucide-react";

import { Surface } from "@/components/ui/surface";

export default function OfflinePage() {
  return (
    <Center minH="100dvh" px="4" py="8">
      <Surface width="full" maxW="440px" p={{ base: "6", md: "8" }} textAlign="center">
        <Stack align="center" gap="5">
          <CloudOff size={20} color="#625F58" aria-hidden="true" />
          <Stack gap="2">
            <Heading as="h1" size="xl" letterSpacing="-0.03em">You’re offline</Heading>
            <Text color="muted">
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

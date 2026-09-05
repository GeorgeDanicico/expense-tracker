"use client";

import { Button, Flex, Heading, Spinner, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Surface } from "@/components/ui/surface";

export function DataLoading({ label = "Loading your ledger…" }: { label?: string }) {
  return (
    <Flex minH="50dvh" align="center" justify="center" aria-busy="true" aria-live="polite">
      <Stack align="center" gap="3" color="gray.500">
        <Spinner size="lg" color="purple.500" borderWidth="3px" />
        <Text fontSize="sm" fontWeight="650">{label}</Text>
      </Stack>
    </Flex>
  );
}

export function DataError({
  message = "Your data could not be loaded. Check your connection and try again.",
  retry,
}: {
  message?: string;
  retry: () => void;
}) {
  return (
    <Flex minH="50dvh" align="center" justify="center">
      <Surface maxW="440px" p={{ base: "6", md: "8" }} textAlign="center">
        <Stack align="center" gap="4">
          <Flex width="14" height="14" align="center" justify="center" borderRadius="2xl" color="red.600" bg="red.50">
            <TriangleAlert size={25} aria-hidden="true" />
          </Flex>
          <Stack gap="2">
            <Heading as="h1" size="xl" letterSpacing="-0.03em">We couldn’t load your data</Heading>
            <Text color="gray.500">{message}</Text>
          </Stack>
          <Button onClick={retry} colorPalette="purple" borderRadius="xl">
            <RefreshCw size={17} aria-hidden="true" /> Try again
          </Button>
        </Stack>
      </Surface>
    </Flex>
  );
}

export function DataUpdating() {
  return (
    <Flex align="center" gap="2" color="gray.400" fontSize="xs" aria-live="polite">
      <Spinner size="xs" /> Updating…
    </Flex>
  );
}

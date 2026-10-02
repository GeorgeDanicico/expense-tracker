"use client";

import { Button, Flex, Heading, Spinner, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Surface } from "@/components/ui/surface";

export function DataLoading({ label = "Loading your ledger…" }: { label?: string }) {
  return (
    <Flex minH="12rem" align="center" justify="center" aria-busy="true" aria-live="polite" role="status">
      <Stack align="center" gap="3" color="muted">
        <Spinner size="sm" color="accent" />
        <Text fontSize="sm" fontWeight="600">{label}</Text>
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
    <Flex minH="12rem" align="center" justify="center" role="alert">
      <Surface maxW="440px" p={{ base: "6", md: "8" }} textAlign="center">
        <Stack align="center" gap="4">
          <TriangleAlert size={20} aria-hidden="true" />
          <Stack gap="2">
            <Heading as="h2">Unable to load data</Heading>
            <Text color="muted">{message}</Text>
          </Stack>
          <Button onClick={retry} minH="11" colorPalette="purple" borderRadius="xl">
            <RefreshCw size={17} aria-hidden="true" /> Try again
          </Button>
        </Stack>
      </Surface>
    </Flex>
  );
}

export function DataUpdating() {
  return (
    <Flex align="center" gap="2" color="muted" fontSize="xs" aria-live="polite" role="status">
      <Spinner size="xs" /> Updating…
    </Flex>
  );
}

export function DataRefresh({ error, updating, retry }: { error?: unknown; updating: boolean; retry: () => void }) {
  if (error) return <Flex role="status" align="center" gap="3" wrap="wrap">
    <Text color="error" fontSize="xs">Refresh failed. Showing the last loaded values.</Text>
    <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
  </Flex>;
  return updating ? <DataUpdating /> : null;
}

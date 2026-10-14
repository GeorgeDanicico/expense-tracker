"use client";

import { Box, Button, Flex, Skeleton, SimpleGrid, Spinner, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";

/**
 * Loading placeholder shaped like the content it replaces. `page` mimics a
 * metrics card plus a list; `section` is a few lines inside an existing card;
 * `screen` is a padded page skeleton for routes rendered before the app shell.
 */
export function DataLoading({
  label = "Loading your ledger…",
  layout = "page",
}: {
  label?: string;
  layout?: "page" | "section" | "screen";
}) {
  return (
    <Box
      aria-busy="true"
      aria-live="polite"
      role="status"
      width="full"
      {...(layout === "screen" ? { maxW: "1200px", mx: "auto", px: { base: "4", md: "6" }, py: { base: "5", md: "8" } } : {})}
    >
      <Text className="sr-only">{label}</Text>
      {layout === "section" ? (
        <Stack gap="2.5" py="2" aria-hidden="true">
          <Skeleton height="4" width="40%" />
          <Skeleton height="4" width="85%" />
          <Skeleton height="4" width="65%" />
        </Stack>
      ) : (
        <Stack gap="4" aria-hidden="true">
          <Card>
            <Card.Body>
              <Stack gap="3">
                <Skeleton height="3" width="5rem" />
                <Skeleton height="8" width="10rem" />
                <SimpleGrid columns={3} gap="4" maxW="24rem">
                  <Skeleton height="4" />
                  <Skeleton height="4" />
                  <Skeleton height="4" />
                </SimpleGrid>
              </Stack>
            </Card.Body>
          </Card>
          <Card>
            <Card.Body>
              <Stack gap="3">
                {[0, 1, 2, 3, 4].map((row) => (
                  <Flex key={row} align="center" gap="3">
                    <Skeleton boxSize="7" borderRadius="control" />
                    <Skeleton height="4" flex="1" />
                    <Skeleton height="4" width="4rem" />
                  </Flex>
                ))}
              </Stack>
            </Card.Body>
          </Card>
        </Stack>
      )}
    </Box>
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
    <Box role="alert">
      <EmptyState
        size="sm"
        icon={<TriangleAlert />}
        titleAs="h2"
        title="Unable to load data"
        description={message}
        action={
          <Button size="sm" variant="outline" onClick={retry}>
            <RefreshCw size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Try again
          </Button>
        }
      />
    </Box>
  );
}

function DataUpdating() {
  return (
    <Flex align="center" gap="1.5" textStyle="caption" aria-live="polite" role="status">
      <Spinner size="xs" color="fg.subtle" /> Updating…
    </Flex>
  );
}

export function DataRefresh({ error, updating, retry }: { error?: unknown; updating: boolean; retry: () => void }) {
  if (error) return (
    <Flex role="status" align="center" gap="2" wrap="wrap">
      <Text textStyle="caption" color="fg.error">Refresh failed. Showing the last loaded values.</Text>
      <Button size="xs" variant="ghost" onClick={retry}>Retry</Button>
    </Flex>
  );
  return updating ? <DataUpdating /> : null;
}

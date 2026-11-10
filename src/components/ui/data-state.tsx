"use client";

import { Box, Button, Flex, Skeleton, SimpleGrid, Spinner, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useSWRConfig } from "swr";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { useOnline } from "@/hooks/use-online";
import { OFFLINE_MESSAGE } from "@/lib/api/client";
import { clearSlow, useSlowKeys } from "@/lib/api/slow-keys";

export const SLOW_MESSAGE = "This is taking longer than usual.";

/**
 * "This is taking longer than usual." with a Retry, once a load has been waiting for the provider's
 * `loadingTimeout` (8 s). `slowKey` is the SWR key being waited for; without one, any slow key counts
 * and Retry reloads them all (a screen that waits on several things).
 */
export function SlowNotice({ slowKey }: { slowKey?: string | null }) {
  const slowKeys = useSlowKeys();
  const { mutate } = useSWRConfig();
  const keys = slowKey ? slowKeys.filter((key) => key === slowKey) : slowKeys;
  if (keys.length === 0) return null;
  return (
    <Flex align="center" gap="3" wrap="wrap" mb="3">
      <Text textStyle="bodySm" color="fg.muted">{SLOW_MESSAGE}</Text>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          for (const key of keys) clearSlow(key);
          void mutate((key) => typeof key === "string" && keys.includes(key));
        }}
      >
        <RefreshCw size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Retry
      </Button>
    </Flex>
  );
}

/**
 * Loading placeholder shaped like the content it replaces. `page` mimics a
 * metrics card plus a list; `section` is a few lines inside an existing card;
 * `screen` is a padded page skeleton for routes rendered before the app shell.
 * `slowKey` (the SWR key it waits for) lets it say when the wait runs long.
 */
export function DataLoading({
  label = "Loading your ledger…",
  layout = "page",
  slowKey,
}: {
  label?: string;
  layout?: "page" | "section" | "screen";
  slowKey?: string | null;
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
      <SlowNotice slowKey={slowKey} />
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
  // With no connection, that is the reason, whatever the screen's own wording says.
  const online = useOnline();
  return (
    <Box role="alert">
      <EmptyState
        size="sm"
        icon={<TriangleAlert />}
        titleAs="h2"
        title="Unable to load data"
        description={online ? message : OFFLINE_MESSAGE}
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

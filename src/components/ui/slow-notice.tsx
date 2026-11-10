"use client";

import { Button, Flex, Text } from "@chakra-ui/react";
import { RefreshCw } from "lucide-react";
import { useSWRConfig } from "swr";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
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

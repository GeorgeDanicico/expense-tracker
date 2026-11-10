"use client";

import { Box, Button } from "@chakra-ui/react";
import { useSWRConfig } from "swr";

import { InlineAlert } from "@/components/ui/inline-alert";
import { useOnline } from "@/hooks/use-online";

export function OfflineStatus() {
  const online = useOnline();
  const { mutate } = useSWRConfig();
  if (online) return null;
  return (
    <Box role="status" mb="4">
      <InlineAlert
        status="warning"
        action={
          <Button
            size="xs"
            variant="outline"
            onClick={() => void mutate(() => true)}
          >
            Retry
          </Button>
        }
      >
        Offline. Reconnect to save changes.
      </InlineAlert>
    </Box>
  );
}

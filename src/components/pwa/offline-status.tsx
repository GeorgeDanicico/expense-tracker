"use client";

import { Box, Button } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

import { InlineAlert } from "@/components/ui/inline-alert";

export function OfflineStatus() {
  const [offline, setOffline] = useState(false);
  const { mutate } = useSWRConfig();
  useEffect(() => {
    function update() {
      setOffline(!navigator.onLine);
    }
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <Box role="status" mb="4">
      <InlineAlert
        status="warning"
        action={
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setOffline(!navigator.onLine);
              void mutate(() => true);
            }}
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

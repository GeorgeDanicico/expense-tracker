"use client";

import { Button, Flex, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

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
    <Flex
      role="status"
      align="center"
      justify="space-between"
      gap="3"
      mb="4"
      borderBottomWidth="1px"
      borderColor="border"
      pb="2"
    >
      <Text color="muted" fontSize="xs">
        Offline. Reconnect to save changes.
      </Text>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOffline(!navigator.onLine);
          void mutate(() => true);
        }}
      >
        Retry
      </Button>
    </Flex>
  );
}

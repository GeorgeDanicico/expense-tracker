"use client";

import { Button, Center } from "@chakra-ui/react";
import { CloudOff, RefreshCw } from "lucide-react";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";

export default function OfflinePage() {
  return (
    <Center minH="100dvh" px="4" py="8">
      <Card width="full" maxW="400px">
        <EmptyState
          icon={<CloudOff />}
          titleAs="h1"
          title="You’re offline"
          description="Reconnect to view or change your private ledger. Financial data is intentionally never stored in the offline cache."
          action={
            <Button asChild variant="solid" colorPalette="brand">
              <a href="/dashboard"><RefreshCw size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Try again</a>
            </Button>
          }
        />
      </Card>
    </Center>
  );
}

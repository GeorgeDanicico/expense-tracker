"use client";

import { Button, Flex } from "@chakra-ui/react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";

/** What an error boundary shows: the page couldn't load, with a button to try again and, with `homeHref`, a way out. */
export function ErrorPage({ onRetry, homeHref }: { onRetry: () => void; homeHref?: string | null }) {
  return (
    <Flex minH="60dvh" align="center" justify="center">
      <Card width="full" maxW="400px">
        <EmptyState
          icon={<TriangleAlert />}
          titleAs="h1"
          title="We couldn’t load this page"
          description="Your data is safe. Check your connection and try again."
          action={
            <Flex gap="2" wrap="wrap" justify="center">
              <Button onClick={onRetry} variant="solid" colorPalette="brand">
                <RefreshCw size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Try again
              </Button>
              {homeHref ? <Button asChild variant="outline"><Link href={homeHref}>Go to Home</Link></Button> : null}
            </Flex>
          }
        />
      </Card>
    </Flex>
  );
}

"use client";

import { Box, Text, type BoxProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { SlowNotice } from "@/components/ui/slow-notice";

/**
 * What every loading state is wrapped in: busy, announced as `label` to a screen reader, and saying so
 * after a slow wait with a Retry (`slowKey`, the SWR key being waited for). The grey shapes inside
 * are `aria-hidden`; a real heading in it is not.
 */
export function SkeletonFrame({ label, slowKey, children, ...box }: { label: string; slowKey?: string | null; children: ReactNode } & BoxProps) {
  return (
    <Box aria-busy="true" aria-live="polite" role="status" width="full" {...box}>
      <Text className="sr-only">{label}</Text>
      <SlowNotice slowKey={slowKey} />
      {children}
    </Box>
  );
}

"use client";

import { Box, Grid } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { useAccount } from "@/hooks/use-account";
import { useCan } from "@/hooks/use-can";

/** Which blocks Home has for this person: spending needs the expenses permission, to-dos a family. Home and its skeleton share it. */
export function useHomeBlocks() {
  const { account } = useAccount();
  const spending = useCan("expenses", "edit");
  const memberId = account?.membership?.memberId ?? null;
  return { spending, todos: memberId !== null, memberId };
}

/**
 * The desktop layout for each mix of blocks (`spending` = the expenses permission, `todos` = a
 * family), keyed `"spending-todos"`: the reminders sit beside the month and the expenses, and
 * span both rows when the to-dos are under them. On a phone every block is one column in this order:
 * the month, what's due, the expenses, the to-dos.
 */
const DESKTOP_AREAS: Record<string, string> = {
  "true-true": `"month due" "recent due" "recent todos"`,
  "true-false": `"month due" "recent due"`,
  "false-true": `"due todos"`,
  "false-false": `"due"`,
};

/** Home's grid of blocks; each block is a `HomeArea` named `month`, `due`, `recent` or `todos`. Home and its skeleton both draw it, so they line up. */
export function HomeGrid({ spending, todos, children }: { spending: boolean; todos: boolean; children: ReactNode }) {
  return (
    <Grid
      gap={PAGE_SPACING.columnGap}
      alignItems="start"
      templateColumns={{ base: "minmax(0, 1fr)", lg: spending ? "minmax(0, 1.15fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)" }}
      templateAreas={{ lg: DESKTOP_AREAS[`${spending}-${todos}`] }}
    >
      {children}
    </Grid>
  );
}

/** One block of the grid. */
export function HomeArea({ area, children }: { area: "month" | "due" | "recent" | "todos"; children: ReactNode }) {
  return <Box gridArea={{ lg: area }}>{children}</Box>;
}

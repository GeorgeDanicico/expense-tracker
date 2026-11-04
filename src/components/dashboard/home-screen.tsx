"use client";

import { Box, Flex, Grid, Heading, Stack, Text } from "@chakra-ui/react";

import { MonthCard, RecentExpenses } from "@/components/dashboard/home-spending";
import { DueReminders } from "@/components/dashboard/home-reminders";
import { FamilyTodos } from "@/components/dashboard/home-todos";
import { useNow } from "@/components/reminders/use-reminders";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { useAccount } from "@/hooks/use-account";
import { useCan } from "@/hooks/use-can";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { greeting, todayLabel } from "@/lib/home/today";

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

/**
 * Home is "today": the month's spending against last month's, what's due with Done and Snooze on
 * the row, the last five expenses and the to-dos assigned to you. Each block links to its section.
 * A block shows only for a user who has its module: spending needs the expenses permission, to-dos
 * a family (reminders are everyone's), so a kid without expenses or a user without a family gets a
 * shorter Home with no empty blocks.
 */
export function HomeScreen() {
  useDocumentTitle("Home");
  const now = useNow();
  const { account } = useAccount();
  const spending = useCan("expenses", "edit");
  const memberId = account?.membership?.memberId ?? null;
  const areas = DESKTOP_AREAS[`${spending}-${memberId !== null}`];
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <Flex align="baseline" justify="space-between" gap="3" wrap="wrap">
        <Heading as="h1" textStyle="pageTitle">{greeting(now)}</Heading>
        <Text textStyle="bodySm" color="fg.muted">{todayLabel(now)}</Text>
      </Flex>
      <Grid
        gap={PAGE_SPACING.columnGap}
        alignItems="start"
        templateColumns={{ base: "minmax(0, 1fr)", lg: spending ? "minmax(0, 1.15fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)" }}
        templateAreas={{ lg: areas }}
      >
        {spending ? <Box gridArea={{ lg: "month" }}><MonthCard /></Box> : null}
        <Box gridArea={{ lg: "due" }}><DueReminders /></Box>
        {spending ? <Box gridArea={{ lg: "recent" }}><RecentExpenses now={now} /></Box> : null}
        {memberId ? <Box gridArea={{ lg: "todos" }}><FamilyTodos memberId={memberId} now={now} /></Box> : null}
      </Grid>
    </Stack>
  );
}

"use client";

import { Flex, Heading, Stack, Text } from "@chakra-ui/react";

import { MonthCard, RecentExpenses } from "@/components/dashboard/home-spending";
import { DueReminders } from "@/components/dashboard/home-reminders";
import { HomeArea, HomeGrid, useHomeBlocks } from "@/components/dashboard/home-layout";
import { FamilyTodos } from "@/components/dashboard/home-todos";
import { REMINDERS_TICK_MS } from "@/components/reminders/use-reminders";
import { useNow } from "@/hooks/use-now";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { greeting, todayLabel } from "@/lib/home/today";

/**
 * Home is "today": the month's spending against last month's, what's due with Done and Snooze on
 * the row, the last five expenses and the to-dos assigned to you. Each block links to its section.
 * A block shows only for a user who has its module: spending needs the expenses permission, to-dos
 * a family (reminders are everyone's), so a kid without expenses or a user without a family gets a
 * shorter Home with no empty blocks.
 */
export function HomeScreen() {
  useDocumentTitle("Home");
  const now = useNow(REMINDERS_TICK_MS);
  const { spending, todos, memberId } = useHomeBlocks();
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <Flex align="baseline" justify="space-between" gap="3" wrap="wrap">
        <Heading as="h1" textStyle="pageTitle">{greeting(now)}</Heading>
        <Text textStyle="bodySm" color="fg.muted">{todayLabel(now)}</Text>
      </Flex>
      <HomeGrid spending={spending} todos={todos}>
        {spending ? <HomeArea area="month"><MonthCard /></HomeArea> : null}
        <HomeArea area="due"><DueReminders /></HomeArea>
        {spending ? <HomeArea area="recent"><RecentExpenses now={now} /></HomeArea> : null}
        {memberId ? <HomeArea area="todos"><FamilyTodos memberId={memberId} now={now} /></HomeArea> : null}
      </HomeGrid>
    </Stack>
  );
}

"use client";

import { Flex, Heading, Stack, Text } from "@chakra-ui/react";

import { MonthCard, MonthCardPending, RecentExpenses, RecentExpensesPending } from "@/components/dashboard/home-spending";
import { DueReminders, DueRemindersPending } from "@/components/dashboard/home-reminders";
import { HomeArea, HomeGrid, useHomeBlocks } from "@/components/dashboard/home-layout";
import { FamilyTodos, FamilyTodosPending } from "@/components/dashboard/home-todos";
import { REMINDERS_TICK_MS } from "@/components/reminders/use-reminders";
import { useNow } from "@/hooks/use-now";
import { StreamedSection } from "@/components/ui/streamed-section";
import { PAGE_SPACING } from "@/components/ui/theme/layout";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { greeting, todayLabel } from "@/lib/home/today";

/**
 * Home is "today": the month's spending against last month's, what's due with Done and Snooze on
 * the row, the last five expenses and the to-dos assigned to you. Each block links to its section.
 * A block shows only for a user who has its module: spending needs the expenses permission, to-dos
 * a family (reminders are everyone's), so a kid without expenses or a user without a family gets a
 * shorter Home with no empty blocks.
 *
 * The heading is drawn at once. Each block waits for its data in a `StreamedSection` of its own (a
 * `<Suspense>`), showing its loading card: on a cold load the server starts the data (`loadHomeFallback`) and the blocks
 * stream in as it arrives, each hydrating on its own (PF6).
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
        {spending ? <HomeArea area="month"><StreamedSection fallback={<MonthCardPending />}><MonthCard /></StreamedSection></HomeArea> : null}
        <HomeArea area="due"><StreamedSection fallback={<DueRemindersPending />}><DueReminders /></StreamedSection></HomeArea>
        {spending ? <HomeArea area="recent"><StreamedSection fallback={<RecentExpensesPending />}><RecentExpenses now={now} /></StreamedSection></HomeArea> : null}
        {memberId ? <HomeArea area="todos"><StreamedSection fallback={<FamilyTodosPending />}><FamilyTodos memberId={memberId} now={now} /></StreamedSection></HomeArea> : null}
      </HomeGrid>
    </Stack>
  );
}

"use client";

import { Box, Flex, Grid, SimpleGrid, Skeleton, Stack, type BoxProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { RowItem } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonFrame } from "@/components/ui/skeleton-frame";
import { LEDGER_COLUMNS, PAGE_SPACING } from "@/components/ui/theme/layout";
import { useAccount } from "@/hooks/use-account";

/*
 * Loading states shaped like the screens they stand in for (phase 16, PF3). A screen's `loading.tsx`
 * and its own client loading state show the same one, so there is one skeleton and then the content,
 * and the swap moves nothing: every block here is built from the same components and spacing as the
 * real one (a card, the row recipe, the page header), and a headed block keeps its real heading.
 * `scripts/lab/skeletons.mjs` compares the heights; docs/performance.md (PF3) has the numbers.
 */

/** What a screen's skeleton takes: the label a screen reader hears and the SWR key whose slow wait it reports. */
type LoadingProps = { label?: string; slowKey?: string | null };

/** One line of text: a bar as tall as the type's line, so the block is as tall as the text it replaces. */
export function Line({ lineHeight, width, bar = "3" }: { lineHeight: BoxProps["height"]; width: string; bar?: string }) {
  return (
    <Flex height={lineHeight} align="center">
      <Skeleton height={bar} width={width} />
    </Flex>
  );
}

/**
 * A list row: the row recipe (so its height is the real one), a tile, two lines and a value.
 * `actions`: a row that carries a button (Done on a reminder, the `⋯` on an expense) is 4px taller.
 */
function RowSkeleton({ detail = false, actions = false }: { detail?: boolean; actions?: boolean }) {
  return (
    <RowItem as="div" {...(actions ? { minH: { base: "3.75rem", md: "3.25rem" } } : {})}>
      <Skeleton boxSize={{ base: "10", md: "9" }} flexShrink="0" borderRadius="control" />
      <Flex direction="column" flex="1" minW="0" gap="0.5">
        <Line lineHeight="1.125rem" width="55%" />
        <Line lineHeight="1rem" width="35%" bar="2.5" />
        {detail ? <Line lineHeight="1rem" width="45%" bar="2.5" /> : null}
      </Flex>
      <Skeleton height="4" width="4rem" flexShrink="0" />
    </RowItem>
  );
}

/** `rows` rows, spaced as the lists space them (`gap`: Home's lists have none, the others 0.5). */
export function ListSkeleton({ rows, detail, actions, gap = "0.5" }: { rows: number; detail?: boolean; actions?: boolean; gap?: string }) {
  return (
    <Stack gap={gap} aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => <RowSkeleton key={row} detail={detail} actions={actions} />)}
    </Stack>
  );
}

/** A small uppercase group caption's height (`GroupLabel`), as a bar. */
function GroupLabelSkeleton({ width = "4.5rem" }: { width?: string }) {
  return (
    <Flex height="1.75rem" px="1" pt="2" pb="1" align="center">
      <Skeleton height="2.5" width={width} />
    </Flex>
  );
}

/** A card with its real heading, and `children` as its body. `title` is a bar when the real one isn't known yet. */
export function HeadedCard({ title, children }: { title: string | null; children: ReactNode }) {
  return (
    <Card size="sm">
      <Card.Header title={title ?? <Skeleton as="span" display="inline-block" height="3.5" width="9rem" verticalAlign="middle" />} />
      <Card.Body>{children}</Card.Body>
    </Card>
  );
}

/** A card of rows with the loading label: a saved tab's expenses, or any list whose heading is already on screen. */
export function RowsCardSkeleton({ label, slowKey, rows = 6 }: { label: string; slowKey?: string | null; rows?: number }) {
  return (
    <SkeletonFrame label={label} slowKey={slowKey}>
      <Card>
        <Card.Body><ListSkeleton rows={rows} /></Card.Body>
      </Card>
    </SkeletonFrame>
  );
}

/** Expenses: a month toolbar and the tab chips, as bars, for a page that has no controls to show yet. */
function LedgerControlsSkeleton() {
  return (
    <Stack gap="3" aria-hidden="true">
      <Flex align="center" gap="2" height={{ base: "11", md: "8" }}><Skeleton boxSize="8" borderRadius="control" /><Skeleton height="5" width="9rem" /><Skeleton boxSize="8" borderRadius="control" /></Flex>
      <Flex gap="2" height={{ base: "11", md: "10" }}><Skeleton height="full" width="5rem" borderRadius="pill" /><Skeleton height="full" width="6rem" borderRadius="pill" /><Skeleton height="full" width="5rem" borderRadius="pill" /></Flex>
    </Stack>
  );
}

/** A day's heading and its rows, as `ExpenseRows` draws them. */
function DaySkeleton({ rows, label }: { rows: number; label?: string }) {
  return (
    <Box>
      <GroupLabelSkeleton width={label} />
      <ListSkeleton rows={rows} actions />
    </Box>
  );
}

/**
 * The month's ledger under `controls`: the summary line and a card of day groups, with "By category"
 * beside them from `lg`: the grid `LedgerPanel` draws. The rows run past the bottom of a phone, as
 * the real list does, so what loads in changes nothing on screen.
 */
export function LedgerSkeleton({ controls, label = "Loading expenses…", slowKey }: { controls?: ReactNode; label?: string; slowKey?: string | null }) {
  return (
    <Grid templateColumns={LEDGER_COLUMNS} gap={PAGE_SPACING.columnGap} alignItems="start">
      <Stack gap="3" minW="0">
        {controls}
        <SkeletonFrame label={label} slowKey={slowKey}>
          <Stack gap="3" aria-hidden="true">
            <Line lineHeight={{ base: "2.25rem", md: "1.125rem" }} width="14rem" />
            <Card>
              <Card.Body>
                <Stack gap="1">
                  <DaySkeleton rows={5} label="4.5rem" />
                  <DaySkeleton rows={5} label="5.5rem" />
                  <DaySkeleton rows={5} label="5rem" />
                </Stack>
              </Card.Body>
            </Card>
          </Stack>
        </SkeletonFrame>
      </Stack>
      <Box display={{ base: "none", lg: "block" }} aria-hidden="true">
        <Card>
          <Card.Header title="By category" description={<Skeleton as="span" display="inline-block" height="3" width="6rem" />} />
          <Card.Body>
            <Stack gap="1.5">{Array.from({ length: 12 }, (_, row) => <Skeleton key={row} height="7" />)}</Stack>
          </Card.Body>
        </Card>
      </Box>
    </Grid>
  );
}

/** The Expenses page: its heading and the ledger. */
export function ExpensesSkeleton({ label, slowKey }: LoadingProps) {
  return (
    <Stack gap="3">
      <PageHeader title="Expenses" inline actions={<Skeleton boxSize="9" borderRadius="control" aria-hidden="true" />} />
      <LedgerSkeleton controls={<LedgerControlsSkeleton />} label={label} slowKey={slowKey} />
    </Stack>
  );
}

/** One board column as `TodoColumn` draws it: its heading, the add button and a run of cards. */
function ColumnSkeleton() {
  return (
    <Box bg="bg.subtle" borderRadius="card" p="3" minW="0">
      <Flex align="center" justify="space-between" mb="2" px="1" height="5"><Skeleton height="3.5" width="6rem" /><Skeleton height="5" width="1.5rem" borderRadius="control" /></Flex>
      <Skeleton height={{ base: "11", md: "8" }} borderRadius="control" />
      <Stack gap="2" mt="2">
        {Array.from({ length: 8 }, (_, card) => <Skeleton key={card} height="4.5rem" borderRadius="card" />)}
      </Stack>
    </Box>
  );
}

/** To-dos: the heading with the family's name, the filter chips and the board (one column at a time on a phone). */
export function TodosSkeleton({ label = "Loading the board…", slowKey }: LoadingProps) {
  const { account } = useAccount();
  const family = account?.membership?.familyName;
  return (
    <SkeletonFrame label={label} slowKey={slowKey}>
      <Stack gap={{ base: "4", md: "5" }}>
        <PageHeader title="To-dos" description={family ? `Shared by everyone in ${family}` : undefined} />
        {/* The filter chips: "Showing" and the people, then (on a phone, a second row; on desktop the same row) the due filters. */}
        <Stack gap="2" aria-hidden="true">
          <Flex gap="2" align="center" height={{ base: "11", md: "8" }}>
            <Skeleton height="3" width="3.5rem" />
            {["6rem", "4rem", "7rem"].map((width) => <Skeleton key={width} height="full" width={width} borderRadius="pill" />)}
          </Flex>
          <Flex gap="2" height="11" display={{ base: "flex", md: "none" }}>
            {["7rem", "6rem"].map((width) => <Skeleton key={width} height="full" width={width} borderRadius="pill" />)}
          </Flex>
        </Stack>
        <Stack gap="3" display={{ base: "flex", md: "none" }} aria-hidden="true">
          <Skeleton height="11" borderRadius="control" />
          <ColumnSkeleton />
        </Stack>
        <SimpleGrid columns={3} gap="4" alignItems="start" display={{ base: "none", md: "grid" }} aria-hidden="true">
          <ColumnSkeleton />
          <ColumnSkeleton />
          <ColumnSkeleton />
        </SimpleGrid>
      </Stack>
    </SkeletonFrame>
  );
}

/** Reminders: the heading and a card of Today and Upcoming rows, with the Done group closed under them. */
export function RemindersSkeleton({ label = "Loading your reminders…", slowKey }: LoadingProps) {
  return (
    <SkeletonFrame label={label} slowKey={slowKey}>
      <Stack gap={{ base: "4", md: "5" }} maxW="4xl">
        <PageHeader title="Reminders" description="Only you can see your reminders." />
        <Card>
          <Card.Body>
            <Stack gap="1" aria-hidden="true">
              <Box><GroupLabelSkeleton /><ListSkeleton rows={4} actions /></Box>
              <Box><GroupLabelSkeleton width="5.5rem" /><ListSkeleton rows={5} actions /></Box>
              <Skeleton height={{ base: "11", md: "8" }} borderRadius="control" />
            </Stack>
          </Card.Body>
        </Card>
      </Stack>
    </SkeletonFrame>
  );
}

/** A page of a heading, a headline card and a card of rows: Investments, Net worth, Insights, Settings and the like. */
export function PanelSkeleton({ title, label, slowKey, rows = 5 }: { title: string; label: string; slowKey?: string | null; rows?: number }) {
  return (
    <SkeletonFrame label={label} slowKey={slowKey}>
      <Stack gap={PAGE_SPACING.sectionGap}>
        <PageHeader title={title} />
        <Card>
          <Card.Body>
            <Stack gap="3" aria-hidden="true">
              <Skeleton height="3" width="5rem" />
              <Skeleton height="8" width="10rem" />
              <SimpleGrid columns={3} gap="4" maxW="24rem"><Skeleton height="4" /><Skeleton height="4" /><Skeleton height="4" /></SimpleGrid>
            </Stack>
          </Card.Body>
        </Card>
        <Card>
          <Card.Body><ListSkeleton rows={rows} /></Card.Body>
        </Card>
      </Stack>
    </SkeletonFrame>
  );
}

/** The calendar under its heading: the date and view controls, and a month grid. */
export function CalendarBodySkeleton({ label = "Loading the calendar…", slowKey }: LoadingProps) {
  return (
    <SkeletonFrame label={label} slowKey={slowKey}>
      <Stack gap={PAGE_SPACING.sectionGap}>
        <Flex height="10" align="center" justify="space-between" aria-hidden="true"><Skeleton height="6" width="10rem" /><Skeleton height="9" width="9rem" borderRadius="control" /></Flex>
        <Card>
          <Card.Body>
            <SimpleGrid columns={7} gap="1" aria-hidden="true">
              {Array.from({ length: 35 }, (_, cell) => <Skeleton key={cell} height={{ base: "3.5rem", md: "6rem" }} borderRadius="control" />)}
            </SimpleGrid>
          </Card.Body>
        </Card>
      </Stack>
    </SkeletonFrame>
  );
}

/** Calendar: the heading and the calendar. */
export function CalendarSkeleton(props: LoadingProps) {
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <PageHeader title="Calendar" />
      <CalendarBodySkeleton {...props} />
    </Stack>
  );
}

/** Insights under its heading and controls: a card of figures and a chart. */
export function InsightsBodySkeleton({ label = "Loading insights…", slowKey }: LoadingProps) {
  return (
    <SkeletonFrame label={label} slowKey={slowKey}>
      <Stack gap={PAGE_SPACING.sectionGap}>
        <Card>
          <Card.Body>
            <SimpleGrid columns={{ base: 2, md: 4 }} gap="4" aria-hidden="true">{[0, 1, 2, 3].map((stat) => <Skeleton key={stat} height="12" />)}</SimpleGrid>
          </Card.Body>
        </Card>
        <Card>
          <Card.Body><Skeleton height="14rem" aria-hidden="true" /></Card.Body>
        </Card>
      </Stack>
    </SkeletonFrame>
  );
}

/** Insights: the heading, a period control and the figures. */
export function InsightsSkeleton(props: LoadingProps) {
  return (
    <Stack gap={PAGE_SPACING.sectionGap}>
      <PageHeader title="Insights" />
      <Skeleton height="10" borderRadius="control" aria-hidden="true" />
      <InsightsBodySkeleton {...props} />
    </Stack>
  );
}

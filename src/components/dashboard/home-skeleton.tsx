"use client";

import { Flex, Skeleton, Stack } from "@chakra-ui/react";

import { HomeArea, HomeGrid } from "@/components/dashboard/home-layout";
import { SkeletonFrame } from "@/components/ui/skeleton-frame";
import { HeadedCard, Line, ListSkeleton } from "@/components/ui/skeletons";
import { PAGE_SPACING } from "@/components/ui/theme/layout";

/** The inside of Home's month card while it loads: the total with its badge, and the meter. */
export function MonthBodySkeleton() {
  return (
    <Stack gap="2" aria-hidden="true">
      <Flex align="center" gap="2.5" wrap="wrap" height="2.25rem">
        <Skeleton height="7" width="9rem" />
        <Skeleton height="5" width="6rem" borderRadius="pill" />
      </Flex>
      <Skeleton height="2" borderRadius="pill" />
    </Stack>
  );
}

/** Home before any of it has loaded: the greeting's place, then the blocks this person has, in Home's own grid. */
export function HomeSkeleton({ spending = true, todos = true, label = "Loading your day…" }: { spending?: boolean; todos?: boolean; label?: string }) {
  return (
    <SkeletonFrame label={label}>
      <Stack gap={PAGE_SPACING.sectionGap}>
        <Flex align="baseline" justify="space-between" gap="3" wrap="wrap" aria-hidden="true">
          <Flex height={{ base: "1.625rem", md: "1.75rem" }} align="center"><Skeleton height="5" width="12rem" /></Flex>
          <Line lineHeight="1.125rem" width="7rem" />
        </Flex>
        <HomeGrid spending={spending} todos={todos}>
          {spending ? <HomeArea area="month"><HeadedCard title={null}><MonthBodySkeleton /></HeadedCard></HomeArea> : null}
          <HomeArea area="due"><HeadedCard title="Due today"><ListSkeleton rows={3} actions gap="0" /></HeadedCard></HomeArea>
          {spending ? <HomeArea area="recent"><HeadedCard title="Recent expenses"><ListSkeleton rows={5} gap="0" /></HeadedCard></HomeArea> : null}
          {todos ? <HomeArea area="todos"><HeadedCard title="To-dos for you"><ListSkeleton rows={3} gap="0" /></HeadedCard></HomeArea> : null}
        </HomeGrid>
      </Stack>
    </SkeletonFrame>
  );
}

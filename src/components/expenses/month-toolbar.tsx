"use client";

import { Box, Button, Field, Flex, Input, Menu, Portal, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { ICON } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { formatMonth, getBucharestMonth, isMonthAllowed, shiftMonth } from "@/lib/calendar";

const ANOTHER_MONTH = "another";
/** How many months the month menu lists, newest first. */
export const MONTH_MENU_LENGTH = 12;

/** The months the menu offers: the newest `MONTH_MENU_LENGTH` up to `maxMonth` (or the current month), newest first. */
export function monthMenuMonths(month: string, maxMonth?: string, currentMonth = getBucharestMonth()) {
  const newest = maxMonth ?? (month > currentMonth ? month : currentMonth);
  return Array.from({ length: MONTH_MENU_LENGTH }, (_, index) => shiftMonth(newest, -index));
}

/**
 * The month as a compact control: ‹ November 2026 ›, where the name opens a menu of the last twelve
 * months and "Another month…" (a month field, for anything older). `children` sits at the end of
 * the row (the Expenses screen's member chip).
 */
export function MonthToolbar({
  month,
  href,
  maxMonth,
  children,
}: {
  month: string;
  href: (month: string) => string;
  maxMonth?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const nextMonth = shiftMonth(month, 1);
  const canAdvance = isMonthAllowed(nextMonth, maxMonth);

  function jumpToMonth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = new FormData(event.currentTarget).get("month");
    if (typeof chosen === "string" && isMonthAllowed(chosen, maxMonth)) {
      setPicking(false);
      router.push(href(chosen));
    }
  }

  return (
    <Box>
      <Flex align="center" gap="0.5">
        <IconButton asChild aria-label="Previous month">
          <Link href={href(shiftMonth(month, -1))}>
            <ChevronLeft size={ICON.nav} />
          </Link>
        </IconButton>
        <Menu.Root
          positioning={{ placement: "bottom" }}
          onSelect={({ value }) => {
            if (value === ANOTHER_MONTH) setPicking(true);
            else router.push(href(value));
          }}
        >
          <Menu.Trigger asChild>
            <Button variant="ghost" size="sm" minW="8rem" px="1.5" aria-label={`Month: ${formatMonth(month)}`}>
              <Text as="span" textStyle="sectionTitle" aria-live="polite">
                {formatMonth(month)}
              </Text>
            </Button>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content minW="44" maxH="72" overflowY="auto">
                {monthMenuMonths(month, maxMonth).map((value) => (
                  <Menu.Item key={value} value={value} fontWeight={value === month ? "semibold" : undefined}>
                    {formatMonth(value)}
                  </Menu.Item>
                ))}
                <Menu.Separator />
                <Menu.Item value={ANOTHER_MONTH}>Another month…</Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
        {canAdvance ? (
          <IconButton asChild aria-label="Next month">
            <Link href={href(nextMonth)}>
              <ChevronRight size={ICON.nav} />
            </Link>
          </IconButton>
        ) : (
          <IconButton disabled aria-label="Next month">
            <ChevronRight size={ICON.nav} />
          </IconButton>
        )}
        {children ? (
          <>
            <Box flex="1" />
            {children}
          </>
        ) : null}
      </Flex>
      {picking ? (
        <form onSubmit={jumpToMonth}>
          <Flex gap="2" align="center" pt="2">
            <Field.Root minW="0" width="11rem">
              <Field.Label srOnly>Month</Field.Label>
              <Input name="month" type="month" size="sm" defaultValue={month} max={maxMonth} required autoFocus />
            </Field.Root>
            <Button type="submit" size="sm" variant="outline">
              Go
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </Flex>
        </form>
      ) : null}
    </Box>
  );
}

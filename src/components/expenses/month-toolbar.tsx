"use client";

import { Button, Field, Flex, Input, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent } from "react";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { formatMonth, isMonthAllowed, shiftMonth } from "@/lib/calendar";

/** One 32px row: ‹ Month › stepper and a compact jump-to-month form. */
export function MonthToolbar({
  month,
  href,
  maxMonth,
}: {
  month: string;
  href: (month: string) => string;
  maxMonth?: string;
}) {
  const router = useRouter();
  const nextMonth = shiftMonth(month, 1);
  const canAdvance = isMonthAllowed(nextMonth, maxMonth);
  function jumpToMonth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextMonth = new FormData(event.currentTarget).get("month");
    if (typeof nextMonth === "string" && isMonthAllowed(nextMonth, maxMonth))
      router.push(href(nextMonth));
  }
  return (
    <Flex align="center" justify="space-between" gap="2" wrap="wrap">
      <Flex align="center" gap="0.5">
        <IconButton asChild size="xs" aria-label="Previous month">
          <Link href={href(shiftMonth(month, -1))}>
            <ChevronLeft size={ICON.sm} strokeWidth={ICON_STROKE} />
          </Link>
        </IconButton>
        <Text minW="6.25rem" textAlign="center" textStyle="bodySm" fontWeight="medium">
          {formatMonth(month)}
        </Text>
        {canAdvance ? (
          <IconButton asChild size="xs" aria-label="Next month">
            <Link
              href={href(nextMonth)}
              onClick={(event) => {
                if (!isMonthAllowed(nextMonth, maxMonth)) event.preventDefault();
              }}
            >
              <ChevronRight size={ICON.sm} strokeWidth={ICON_STROKE} />
            </Link>
          </IconButton>
        ) : (
          <IconButton disabled size="xs" aria-label="Next month">
            <ChevronRight size={ICON.sm} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
      </Flex>
      <form onSubmit={jumpToMonth} style={{ maxWidth: "100%" }}>
        <Flex gap="1" align="center">
          <Field.Root minW="0" width={{ base: "9.5rem", md: "8.75rem" }}>
            <Field.Label srOnly>Month</Field.Label>
            <Input
              key={month}
              name="month"
              type="month"
              size="xs"
              defaultValue={month}
              max={maxMonth}
              required
            />
          </Field.Root>
          <Button type="submit" size="xs" variant="outline">
            Go
          </Button>
        </Flex>
      </form>
    </Flex>
  );
}

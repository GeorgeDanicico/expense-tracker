"use client";

import { Button, Field, Flex, Input, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent } from "react";
import { formatMonth, isValidMonth, shiftMonth } from "@/lib/utils/dates";

export function MonthToolbar({
  month,
  href,
}: {
  month: string;
  href: (month: string) => string;
}) {
  const router = useRouter();
  function jumpToMonth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextMonth = new FormData(event.currentTarget).get("month");
    if (typeof nextMonth === "string" && isValidMonth(nextMonth))
      router.push(href(nextMonth));
  }
  return (
    <Flex align="center" justify="space-between" gap="3" wrap="wrap">
      <Flex align="center" gap="1">
        <Button asChild size="sm" variant="ghost" aria-label="Previous month">
          <Link href={href(shiftMonth(month, -1))}>
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
        </Button>
        <Text minW="8rem" textAlign="center" fontWeight="500">
          {formatMonth(month)}
        </Text>
        <Button asChild size="sm" variant="ghost" aria-label="Next month">
          <Link href={href(shiftMonth(month, 1))}>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </Button>
      </Flex>
      <form onSubmit={jumpToMonth} style={{ maxWidth: "100%" }}>
        <Flex gap="2" align="end">
          <Field.Root minW="0">
            <Field.Label>Month</Field.Label>
            <Input
              key={month}
              name="month"
              type="month"
              size="sm"
              defaultValue={month}
              required
            />
          </Field.Root>
          <Button type="submit" size="sm" variant="outline">
            Go
          </Button>
        </Flex>
      </form>
    </Flex>
  );
}

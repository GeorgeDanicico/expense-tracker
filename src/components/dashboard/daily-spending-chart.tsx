import { Box, Flex, Stack, Text } from "@chakra-ui/react";

import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";

export function DailySpendingChart({
  days,
  currency,
}: {
  days: { key: string; label: string; total: number }[];
  currency: string;
}) {
  const max = Math.max(...days.map((day) => day.total), 1);
  return (
    <Box
      overflowX="auto"
      tabIndex={0}
      role="region"
      aria-label="Daily spending, scroll to see every day"
      borderRadius="control"
      _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "2px" }}
    >
      <Flex
        as="ul"
        align="end"
        gap="1"
        listStyleType="none"
        minW={`${days.length * 3.75}rem`}
        height="10.5rem"
        pb="1"
      >
        {days.map((day) => (
          <Stack
            as="li"
            key={day.key}
            width="3.5rem"
            flexShrink="0"
            height="full"
            align="center"
            justify="end"
            gap="1.5"
            aria-label={`${formatDate(day.key)}: ${formatCurrency(day.total, currency)}`}
          >
            <Text textStyle="caption" color={day.total ? "fg" : "fg.subtle"} textAlign="center" overflowWrap="anywhere">
              {formatCurrency(day.total, currency)}
            </Text>
            <Box
              aria-hidden="true"
              width="2"
              minH="2px"
              height={`${(day.total / max) * 100}px`}
              bg={day.total ? "chart.bar" : "chart.track"}
              borderRadius="full"
            />
            <Text textStyle="caption">{day.label}</Text>
          </Stack>
        ))}
      </Flex>
    </Box>
  );
}

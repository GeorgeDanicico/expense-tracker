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
    >
      <Flex
        as="ul"
        align="end"
        gap="2"
        listStyleType="none"
        minW={`${days.length * 4.75}rem`}
        height="12.5rem"
        pb="2"
      >
        {days.map((day) => (
          <Stack
            as="li"
            key={day.key}
            width="4.25rem"
            flexShrink="0"
            height="full"
            align="center"
            justify="end"
            gap="2"
            aria-label={`${formatDate(day.key)}: ${formatCurrency(day.total, currency)}`}
          >
            <Text fontSize="xs" textAlign="center" overflowWrap="anywhere">
              {formatCurrency(day.total, currency)}
            </Text>
            <Box
              aria-hidden="true"
              width="5"
              minH="2px"
              height={`${(day.total / max) * 125}px`}
              bg={day.total ? "clay" : "border"}
              borderRadius="sm"
            />
            <Text fontSize="xs" color="muted">
              {day.label}
            </Text>
          </Stack>
        ))}
      </Flex>
    </Box>
  );
}

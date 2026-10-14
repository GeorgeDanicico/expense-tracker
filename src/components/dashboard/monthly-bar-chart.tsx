import { Box, Flex, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import { ChartBar } from "@/components/dashboard/chart-bar";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatMonth } from "@/lib/calendar";

function formatSeriesLabel(key: string) {
  if (/^\d{4}-\d{2}$/.test(key)) return formatMonth(key);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return formatDate(key);
  return key;
}

export function MonthlyBarChart({
  series,
  currency,
  ariaLabel = "Spending by month",
  getHref,
}: {
  series: { key: string; label: string; total: number }[];
  currency: string;
  ariaLabel?: string;
  getHref?: (item: { key: string; label: string; total: number }) => string | null;
}) {
  const max = Math.max(...series.map((item) => item.total), 1);
  if (!series.length) return <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>;
  return (
    <Stack as="ul" gap="0.5" listStyleType="none" aria-label={ariaLabel} mx="-2">
      {series.map((item) => {
        const href = getHref
          ? getHref(item)
          : /^\d{4}-\d{2}(-\d{2})?$/.test(item.key)
            ? `/expenses?month=${item.key.slice(0, 7)}`
            : null;
        const content = (
          <Stack gap="1">
            <Flex justify="space-between" align="baseline" gap="2" wrap="wrap">
              <Text textStyle="bodySm">{item.label || formatSeriesLabel(item.key)}</Text>
              <Text textStyle="amountSm" overflowWrap="anywhere">
                {formatCurrency(item.total, currency)}
              </Text>
            </Flex>
            <ChartBar share={(item.total / max) * 100} />
          </Stack>
        );

        return (
          <Box as="li" key={item.key}>
            {href ? (
              <ChakraLink
                asChild
                display="block"
                px="2"
                py="1.5"
                color="fg"
                borderRadius="control"
                _hover={{ textDecoration: "none", bg: "bg.subtle" }}
              >
                <Link href={href}>{content}</Link>
              </ChakraLink>
            ) : (
              <Box px="2" py="1.5">
                {content}
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

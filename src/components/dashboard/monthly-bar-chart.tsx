import { Box, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatMonth } from "@/lib/utils/dates";

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
  if (!series.length) return <Text color="muted">No recorded expenses</Text>;
  return (
    <Stack as="ul" gap="2" listStyleType="none" aria-label={ariaLabel}>
      {series.map((item) => {
        const href = getHref
          ? getHref(item)
          : /^\d{4}-\d{2}(-\d{2})?$/.test(item.key)
            ? `/expenses?month=${item.key.slice(0, 7)}`
            : null;
        const content = (
          <Stack gap="1">
            <Box
              display="flex"
              flexWrap="wrap"
              justifyContent="space-between"
              gap="2"
            >
              <Text fontSize="sm">{item.label || formatSeriesLabel(item.key)}</Text>
              <Text fontSize="sm" fontWeight="600" overflowWrap="anywhere">
                {formatCurrency(item.total, currency)}
              </Text>
            </Box>
            <Box
              height="2"
              bg="canvas"
              borderRadius="full"
              aria-hidden="true"
            >
              <Box
                height="full"
                width={`${(item.total / max) * 100}%`}
                bg="clay"
                borderRadius="full"
              />
            </Box>
          </Stack>
        );

        return (
          <Box as="li" key={item.key}>
            {href ? (
              <ChakraLink
                asChild
                display="block"
                minH="11"
                color="fg"
                _hover={{ textDecoration: "none", bg: "canvas" }}
                borderRadius="lg"
                p="2"
              >
                <Link href={href}>{content}</Link>
              </ChakraLink>
            ) : (
              <Box minH="11" borderRadius="lg" p="2">
                {content}
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

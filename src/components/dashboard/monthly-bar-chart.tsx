import { Box, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatMonth } from "@/lib/utils/dates";

export function MonthlyBarChart({
  series,
  currency,
}: {
  series: { key: string; label: string; total: number }[];
  currency: string;
}) {
  const max = Math.max(...series.map((item) => item.total), 1);
  if (!series.length) return <Text color="muted">No recorded expenses</Text>;
  return (
    <Stack as="ul" gap="2" listStyleType="none" aria-label="Spending by month">
      {series.map((item) => (
        <Box as="li" key={item.key}>
          <ChakraLink
            asChild
            display="block"
            minH="11"
            color="fg"
            _hover={{ textDecoration: "none", bg: "canvas" }}
            borderRadius="lg"
            p="2"
          >
            <Link href={`/expenses?month=${item.key.slice(0, 7)}`}>
              <Stack gap="1">
                <Box
                  display="flex"
                  flexWrap="wrap"
                  justifyContent="space-between"
                  gap="2"
                >
                  <Text fontSize="sm">
                    {item.key.length === 7
                      ? formatMonth(item.key)
                      : formatDate(item.key)}
                  </Text>
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
            </Link>
          </ChakraLink>
        </Box>
      ))}
    </Stack>
  );
}

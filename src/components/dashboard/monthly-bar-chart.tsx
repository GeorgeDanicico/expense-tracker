import { Box, Flex, Stack, Text } from "@chakra-ui/react";

import { formatCurrency } from "@/lib/utils/currency";

export function MonthlyBarChart({
  series,
  currency,
}: {
  series: { key: string; label: string; total: number }[];
  currency: string;
}) {
  const max = Math.max(...series.map((item) => item.total), 1);
  const total = series.reduce((sum, item) => sum + item.total, 0);
  const average = total / Math.max(series.length, 1);

  if (!series.length) {
    return (
      <Flex minH="18rem" align="center" justify="center" textAlign="center">
        <Stack gap="1">
          <Text fontWeight="700">No spending history yet</Text>
          <Text color="gray.500" fontSize="sm">Your monthly trend will appear here.</Text>
        </Stack>
      </Flex>
    );
  }

  return (
    <Box overflowX="auto" pb="1">
      <Flex
        minW={series.length > 12 ? "860px" : series.length > 6 ? "620px" : "100%"}
        height={{ base: "230px", md: "270px" }}
        align="end"
        gap={{ base: "2", md: "3" }}
        px="1"
        pt="6"
        role="img"
        aria-label={`Expense totals by month. Average ${formatCurrency(average, currency)}.`}
      >
        {series.map((item) => {
          const height = item.total ? Math.max((item.total / max) * 178, 8) : 3;
          const aboveAverage = item.total >= average && item.total > 0;

          return (
            <Stack key={item.key} flex="1" minW="42px" height="full" justify="end" align="center" gap="2">
              <Text
                color="gray.500"
                fontSize="10px"
                fontWeight="650"
                whiteSpace="nowrap"
                opacity={item.total ? 1 : 0}
              >
                {item.total ? formatCurrency(item.total, currency) : "—"}
              </Text>
              <Box
                width="full"
                maxW="52px"
                height={`${height}px`}
                borderRadius="lg lg sm sm"
                bg={item.total ? (aboveAverage ? "purple.600" : "purple.300") : "gray.200"}
                boxShadow={aboveAverage ? "0 7px 15px rgb(124 58 237 / 16%)" : "none"}
                transition="height 180ms ease, background 180ms ease"
                title={`${item.label}: ${formatCurrency(item.total, currency)}`}
              />
              <Text color="gray.500" fontSize="xs" fontWeight="600" whiteSpace="nowrap">{item.label}</Text>
            </Stack>
          );
        })}
      </Flex>
    </Box>
  );
}

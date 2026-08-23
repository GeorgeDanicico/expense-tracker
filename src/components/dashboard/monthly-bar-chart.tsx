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

  if (!series.length) {
    return <Text color="gray.500">No months are available for this range.</Text>;
  }

  return (
    <Box overflowX="auto" pb="2">
      <Flex minW={series.length > 12 ? "900px" : "560px"} height="260px" align="end" gap="3" role="img" aria-label="Expense totals by month">
        {series.map((item) => {
          const height = item.total ? Math.max((item.total / max) * 190, 4) : 2;
          return (
            <Stack key={item.key} flex="1" minW="38px" height="full" justify="end" align="center" gap="2">
              <Text fontSize="xs" color="gray.600" whiteSpace="nowrap">
                {item.total ? formatCurrency(item.total, currency) : "—"}
              </Text>
              <Box
                width="full"
                maxW="54px"
                height={`${height}px`}
                bg={item.total ? "blue.600" : "gray.200"}
                transition="height 160ms ease"
              />
              <Text fontSize="xs" color="gray.500" whiteSpace="nowrap">{item.label}</Text>
            </Stack>
          );
        })}
      </Flex>
    </Box>
  );
}

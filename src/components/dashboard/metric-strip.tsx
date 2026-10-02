import { SimpleGrid, Stack, Text } from "@chakra-ui/react";

export function MetricStrip({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <SimpleGrid
      as="dl"
      gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 8rem), 1fr))"
      gap="4"
      py="4"
      borderBlockWidth="1px"
      borderColor="border"
    >
      {items.map(({ label, value }) => (
        <Stack key={label} gap="1" minW="0">
          <Text as="dt" color="muted" fontSize="sm">
            {label}
          </Text>
          <Text
            as="dd"
            fontSize="1.5rem"
            fontWeight="600"
            lineHeight="1.3"
            overflowWrap="anywhere"
          >
            {value}
          </Text>
        </Stack>
      ))}
    </SimpleGrid>
  );
}

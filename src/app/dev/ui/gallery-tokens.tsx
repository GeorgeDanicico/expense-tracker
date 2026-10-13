import { Box, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";

import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";

const TEXT_STYLES = [
  ["pageTitle", "Page title"],
  ["sectionTitle", "Section title"],
  ["dialogTitle", "Dialog title"],
  ["body", "Body text"],
  ["bodySm", "Small body text for tables and lists"],
  ["label", "Field and metric label"],
  ["caption", "Caption, helper text and meta"],
  ["amountHero", "€2,481.35"],
  ["amountLg", "€1,234.50"],
  ["amount", "€1,234.50"],
  ["amountSm", "€1,234.50"],
] as const;

const SWATCHES = [
  "bg.canvas", "bg.surface", "bg.subtle", "bg.muted", "bg.selected",
  "fg", "fg.muted", "fg.subtle", "fg.accent",
  "border", "border.strong", "chart.bar",
  "status.positive.fg", "status.negative.fg", "status.warning.fg", "status.info.fg",
  "status.positive.bg", "status.negative.bg", "status.warning.bg", "status.info.bg",
];

export function TypeScale() {
  return (
    <Stack gap="3">
      {TEXT_STYLES.map(([style, sample]) => (
        <Flex key={style} gap="3" align="baseline" wrap="wrap">
          <Text textStyle="caption" width="6.5rem" flexShrink="0">{style}</Text>
          <Text textStyle={style}>{sample}</Text>
        </Flex>
      ))}
    </Stack>
  );
}

function Swatch({ token, fg }: { token: string; fg?: string }) {
  return (
    <Stack gap="1" minW="0">
      <Box
        height="8"
        borderRadius="control"
        borderWidth="1px"
        borderColor="border"
        bg={fg ? `category.${fg}.bg` : token}
        color={fg ? `category.${fg}.fg` : undefined}
        display="flex"
        alignItems="center"
        justifyContent="center"
        textStyle="label"
      >
        {fg ? "Aa" : null}
      </Box>
      <Text textStyle="caption" truncate>{token}</Text>
    </Stack>
  );
}

export function TokenSwatches() {
  return (
    <Stack gap="4">
      <SimpleGrid columns={{ base: 3, md: 4 }} gap="3">
        {SWATCHES.map((token) => <Swatch key={token} token={token} />)}
      </SimpleGrid>
      <SimpleGrid columns={{ base: 3, md: 4 }} gap="3">
        {EXPENSE_CATEGORIES.map((key) => <Swatch key={key} token={`category.${key}`} fg={key} />)}
      </SimpleGrid>
    </Stack>
  );
}

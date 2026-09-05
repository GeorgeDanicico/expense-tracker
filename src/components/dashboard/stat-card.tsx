import { Flex, Stack, Text } from "@chakra-ui/react";

import { Surface } from "@/components/ui/surface";

export function StatCard({
  label,
  value,
  helper,
  icon,
  accent = "purple",
}: {
  label: string;
  value: string;
  helper?: string;
  icon?: React.ReactNode;
  accent?: "purple" | "green" | "blue" | "orange";
}) {
  const colors = {
    purple: { bg: "purple.50", color: "purple.700", glow: "rgb(124 58 237 / 9%)" },
    green: { bg: "green.50", color: "green.700", glow: "rgb(22 163 74 / 8%)" },
    blue: { bg: "blue.50", color: "blue.700", glow: "rgb(37 99 235 / 8%)" },
    orange: { bg: "orange.50", color: "orange.700", glow: "rgb(234 88 12 / 8%)" },
  }[accent];

  return (
    <Surface
      position="relative"
      overflow="hidden"
      p={{ base: "4", md: "5" }}
      _before={{
        content: '""',
        position: "absolute",
        width: "7rem",
        height: "7rem",
        right: "-3.5rem",
        top: "-4rem",
        borderRadius: "full",
        bg: colors.glow,
      }}
    >
      <Flex align="flex-start" justify="space-between" gap="3">
        <Stack minW="0" gap="1.5">
          <Text color="gray.500" fontSize="sm" fontWeight="600">{label}</Text>
          <Text color="gray.900" fontSize={{ base: "xl", lg: "2xl" }} fontWeight="800" letterSpacing="-0.035em" lineHeight="1.15" truncate>
            {value}
          </Text>
          {helper ? <Text color="gray.400" fontSize="xs">{helper}</Text> : null}
        </Stack>
        {icon ? (
          <Flex
            width="10"
            height="10"
            flexShrink="0"
            align="center"
            justify="center"
            borderRadius="xl"
            color={colors.color}
            bg={colors.bg}
          >
            {icon}
          </Flex>
        ) : null}
      </Flex>
    </Surface>
  );
}

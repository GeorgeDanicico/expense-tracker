import { Stack, Text } from "@chakra-ui/react";
import { Surface } from "@/components/ui/surface";

export function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
  icon?: React.ReactNode;
  accent?: "purple" | "green" | "blue" | "orange";
}) {
  return (
    <Surface p="4">
      <Stack gap="1">
        <Text color="muted" fontSize="sm">
          {label}
        </Text>
        <Text fontSize="1.5rem" fontWeight="600" overflowWrap="anywhere">
          {value}
        </Text>
        {helper ? (
          <Text color="muted" fontSize="xs">
            {helper}
          </Text>
        ) : null}
      </Stack>
    </Surface>
  );
}

import { Box, Stack, Text } from "@chakra-ui/react";

export function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" p="5">
      <Stack gap="1">
        <Text fontSize="sm" color="gray.500">{label}</Text>
        <Text fontSize="2xl" fontWeight="bold" color="gray.900" lineHeight="1.2">{value}</Text>
        {helper ? <Text fontSize="xs" color="gray.500">{helper}</Text> : null}
      </Stack>
    </Box>
  );
}

import { Box, Center, Heading, Stack, Text } from "@chakra-ui/react";

export default function OfflinePage() {
  return (
    <Center minH="100dvh" px="4">
      <Box bg="white" borderWidth="1px" borderColor="gray.200" p="8" maxW="440px">
        <Stack gap="3">
          <Heading as="h1" size="xl">You are offline</Heading>
          <Text color="gray.600">
            Reconnect to view or change your private expense data. This app does not store ledger data in the offline cache.
          </Text>
        </Stack>
      </Box>
    </Center>
  );
}

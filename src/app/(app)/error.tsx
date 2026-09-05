"use client";

import { Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Surface } from "@/components/ui/surface";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Flex minH="60dvh" align="center" justify="center">
      <Surface maxW="440px" p={{ base: "6", md: "8" }} textAlign="center">
        <Stack align="center" gap="4">
          <Flex width="14" height="14" align="center" justify="center" borderRadius="2xl" color="red.600" bg="red.50">
            <TriangleAlert size={25} aria-hidden="true" />
          </Flex>
          <Stack gap="2">
            <Heading as="h1" size="xl" letterSpacing="-0.03em">We couldn’t load this page</Heading>
            <Text color="gray.500">Your data is safe. Check your connection and try again.</Text>
          </Stack>
          <Button onClick={reset} colorPalette="purple" borderRadius="xl">
            <RefreshCw size={17} aria-hidden="true" /> Try again
          </Button>
        </Stack>
      </Surface>
    </Flex>
  );
}

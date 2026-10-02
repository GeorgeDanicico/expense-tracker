import { Box, type BoxProps } from "@chakra-ui/react";

export function Surface(props: BoxProps) {
  return (
    <Box
      bg="surface"
      borderWidth="1px"
      borderColor="border"
      borderRadius="2xl"
      {...props}
    />
  );
}

import { Box, type BoxProps } from "@chakra-ui/react";

export function Surface(props: BoxProps) {
  return (
    <Box
      bg="white"
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius={{ base: "2xl", md: "3xl" }}
      boxShadow="0 1px 2px rgb(16 24 40 / 3%), 0 12px 32px rgb(16 24 40 / 4%)"
      {...props}
    />
  );
}

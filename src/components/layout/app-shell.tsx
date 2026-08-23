import {
  Box,
  Button,
  Container,
  Flex,
  HStack,
  Link as ChakraLink,
  Stack,
  Text,
} from "@chakra-ui/react";
import { BarChart3, BookOpen, LogOut, Settings } from "lucide-react";
import Link from "next/link";

import { logoutAction } from "@/app/(app)/actions";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/expenses", label: "Expenses", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavigationLinks() {
  return links.map(({ href, label, icon: Icon }) => (
    <ChakraLink
      key={href}
      asChild
      color="gray.700"
      fontWeight="medium"
      _hover={{ color: "blue.700", textDecoration: "none" }}
    >
      <Link href={href}>
        <Icon size={18} aria-hidden="true" />
        {label}
      </Link>
    </ChakraLink>
  ));
}

export function AppShell({ children, email }: { children: React.ReactNode; email: string }) {
  return (
    <Box minH="100dvh">
      <Box as="header" bg="white" borderBottomWidth="1px" borderColor="gray.200">
        <Container maxW="1180px" py="3">
          <Flex align="center" justify="space-between" gap="4">
            <HStack gap="3">
              <Box
                bg="blue.700"
                color="white"
                width="9"
                height="9"
                display="grid"
                placeItems="center"
                fontWeight="bold"
              >
                SL
              </Box>
              <Stack gap="0">
                <Text fontWeight="bold" lineHeight="1.2">Simple Ledger</Text>
                <Text fontSize="xs" color="gray.500">Private expense book</Text>
              </Stack>
            </HStack>

            <HStack gap="7" display={{ base: "none", md: "flex" }}>
              <NavigationLinks />
            </HStack>

            <HStack gap="3">
              <Text
                fontSize="sm"
                color="gray.500"
                display={{ base: "none", lg: "block" }}
                maxW="220px"
                truncate
              >
                {email}
              </Text>
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm" aria-label="Sign out">
                  <LogOut size={16} aria-hidden="true" />
                  <Text display={{ base: "none", sm: "inline" }}>Sign out</Text>
                </Button>
              </form>
            </HStack>
          </Flex>
        </Container>
      </Box>

      <Container as="main" maxW="1180px" py={{ base: "6", md: "9" }}>
        {children}
      </Container>

      <Flex
        as="nav"
        position="fixed"
        bottom="0"
        insetX="0"
        zIndex="docked"
        display={{ base: "flex", md: "none" }}
        bg="white"
        borderTopWidth="1px"
        borderColor="gray.200"
        px="8"
        py="4"
        justify="space-around"
        css={{
          "@supports (padding-bottom: env(safe-area-inset-bottom))": {
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          },
        }}
      >
        <NavigationLinks />
      </Flex>
    </Box>
  );
}

"use client";

import { Box, Flex, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import { ChartNoAxesCombined, CreditCard, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Overview", icon: ChartNoAxesCombined },
  { href: "/expenses", label: "Expenses", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function DesktopNavigation() {
  const pathname = usePathname();

  return (
    <Stack as="nav" aria-label="Primary navigation" gap="1.5">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);

        return (
          <ChakraLink
            key={href}
            asChild
            display="flex"
            alignItems="center"
            gap="3"
            minH="11"
            px="3.5"
            borderRadius="xl"
            color={active ? "purple.700" : "gray.600"}
            bg={active ? "purple.50" : "transparent"}
            fontSize="sm"
            fontWeight={active ? "700" : "600"}
            _hover={{ color: "purple.700", bg: active ? "purple.50" : "gray.50", textDecoration: "none" }}
            transition="background 160ms ease, color 160ms ease"
          >
            <Link href={href} aria-current={active ? "page" : undefined}>
              <Flex
                width="8"
                height="8"
                align="center"
                justify="center"
                borderRadius="lg"
                bg={active ? "purple.100" : "transparent"}
              >
                <Icon size={18} strokeWidth={active ? 2.3 : 2} aria-hidden="true" />
              </Flex>
              {label}
            </Link>
          </ChakraLink>
        );
      })}
    </Stack>
  );
}

export function MobileNavigation() {
  const pathname = usePathname();

  return (
    <Flex
      as="nav"
      aria-label="Primary navigation"
      position="fixed"
      bottom="0"
      insetX="0"
      zIndex="docked"
      display={{ base: "flex", md: "none" }}
      justify="space-around"
      gap="1"
      px="3"
      pt="2"
      bg="whiteAlpha.950"
      borderTopWidth="1px"
      borderColor="gray.200"
      boxShadow="0 -10px 30px rgb(30 27 75 / 7%)"
      backdropFilter="blur(18px)"
      css={{
        "@supports (padding-bottom: env(safe-area-inset-bottom))": {
          paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
        },
      }}
    >
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);

        return (
          <ChakraLink
            key={href}
            asChild
            flex="1"
            maxW="7rem"
            minH="14"
            display="flex"
            alignItems="center"
            justifyContent="center"
            borderRadius="xl"
            color={active ? "purple.700" : "gray.500"}
            bg={active ? "purple.50" : "transparent"}
            fontSize="xs"
            fontWeight="700"
            _hover={{ textDecoration: "none" }}
          >
            <Link href={href} aria-current={active ? "page" : undefined}>
              <Stack width="full" align="center" justify="center" gap="1">
                <Box position="relative">
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                  {active ? (
                    <Box
                      position="absolute"
                      top="-1"
                      right="-2"
                      width="1.5"
                      height="1.5"
                      borderRadius="full"
                      bg="purple.500"
                    />
                  ) : null}
                </Box>
                <Text>{label}</Text>
              </Stack>
            </Link>
          </ChakraLink>
        );
      })}
    </Flex>
  );
}

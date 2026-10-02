"use client";

import {
  Box,
  Button,
  Dialog,
  Flex,
  Link as ChakraLink,
  Portal,
  Separator,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  CreditCard,
  House,
  MoreHorizontal,
  Scale,
  Settings2,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { InstallInstructions } from "@/components/pwa/install-instructions";

const links = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/expenses", label: "Expenses", icon: CreditCard },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/net-worth", label: "Net worth", icon: Scale },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function NavigationLink({
  href,
  onNavigate,
}: {
  href: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const item = links.find((link) => link.href === href)!;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = item.icon;
  return (
    <ChakraLink
      asChild
      display="flex"
      alignItems="center"
      gap="3"
      minH="11"
      px="3"
      borderRadius="lg"
      color={active ? "accent" : "muted"}
      bg={active ? "selected" : "transparent"}
      fontSize="sm"
      fontWeight="500"
      _hover={{ bg: "selected", textDecoration: "none" }}
    >
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
      >
        <Icon size={18} aria-hidden="true" />
        {item.label}
      </Link>
    </ChakraLink>
  );
}

export function DesktopNavigation() {
  return (
    <Stack as="nav" aria-label="Primary navigation" gap="1">
      <NavigationLink href="/dashboard" />
      <NavigationLink href="/expenses" />
      <Separator my="3" borderColor="border" />
      <NavigationLink href="/investments" />
      <NavigationLink href="/net-worth" />
    </Stack>
  );
}

export function MobileNavigation({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = links
    .slice(2)
    .some(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  return (
    <Flex
      as="nav"
      aria-label="Primary navigation"
      position="fixed"
      bottom="0"
      insetX="0"
      zIndex="docked"
      display={{ base: "flex", md: "none" }}
      bg="surface"
      borderTopWidth="1px"
      borderColor="border"
      px="4"
      pt="1"
      pb="calc(0.25rem + env(safe-area-inset-bottom))"
      gap="2"
    >
      {links.slice(0, 2).map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <ChakraLink
            key={href}
            asChild
            flex="1"
            minW="0"
            minH="14"
            justifyContent="center"
            borderRadius="lg"
            color={active ? "accent" : "muted"}
            bg={active ? "selected" : "transparent"}
            _hover={{ textDecoration: "none" }}
          >
            <Link href={href} aria-current={active ? "page" : undefined}>
              <Stack align="center" gap="1">
                <Icon size={20} aria-hidden="true" />
                <Text
                  fontSize="xs"
                  fontWeight="500"
                  overflowWrap="anywhere"
                  textAlign="center"
                >
                  {label}
                </Text>
              </Stack>
            </Link>
          </ChakraLink>
        );
      })}
      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => setOpen(open)}
        placement="bottom"
        size="sm"
      >
        <Dialog.Trigger asChild>
          <Button
            flex="1"
            px="0"
            minH="14"
            variant="ghost"
            color={moreActive ? "accent" : "muted"}
            bg={moreActive ? "selected" : "transparent"}
            aria-current={moreActive ? "page" : undefined}
          >
            <Stack align="center" gap="1">
              <MoreHorizontal size={20} aria-hidden="true" />
              <Text fontSize="xs" fontWeight="500">
                More
              </Text>
            </Stack>
          </Button>
        </Dialog.Trigger>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner
            p="4"
            pb="calc(1rem + env(safe-area-inset-bottom))"
          >
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>More</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="2">
                  <NavigationLink
                    href="/investments"
                    onNavigate={() => setOpen(false)}
                  />
                  <NavigationLink
                    href="/net-worth"
                    onNavigate={() => setOpen(false)}
                  />
                  <NavigationLink
                    href="/settings"
                    onNavigate={() => setOpen(false)}
                  />
                  <Separator borderColor="border" />
                  <Text
                    px="3"
                    color="muted"
                    fontSize="xs"
                    overflowWrap="anywhere"
                  >
                    {email}
                  </Text>
                  <SignOutButton />
                  <Box>
                    <InstallInstructions />
                  </Box>
                </Stack>
              </Dialog.Body>
              <Dialog.CloseTrigger asChild>
                <Button variant="ghost" aria-label="Close More">
                  <X size={18} aria-hidden="true" />
                </Button>
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Flex>
  );
}

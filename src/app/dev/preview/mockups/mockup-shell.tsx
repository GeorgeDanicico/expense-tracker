"use client";

import { Box, Button, Flex, Grid, Stack, Switch, Text } from "@chakra-ui/react";
import {
  BellRing,
  CalendarDays,
  CreditCard,
  House,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Scale,
  Settings2,
  SquareKanban,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import NextLink from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Brand } from "@/components/layout/brand";
import { ICON } from "@/components/ui";

import { MockStateProvider, useMockState } from "./mock-state";
import { mockupById, mockupHref, type BarTab, type Mockup, type MockupId, type SidebarItem } from "./mockups";
import { ProposedThemeScope } from "./motion-scope";
import { PROPOSED_SPACING, radius, transition } from "./proposed-theme";
import { QuickAddSheet } from "./quick-add";
import { UndoToast } from "./stand-ins";

/** Wraps each mockup in the proposed theme and the stand-in shell; the index page renders as it is. */
export function MockupShell({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const mockup = segment ? mockupById(segment) : undefined;
  const [reduced, setReduced] = useState(false);
  if (!mockup) return children;
  return (
    <ProposedThemeScope reduced={reduced} minH="100dvh" bg="bg.canvas">
      <MockStateProvider key={mockup.id} initialQuickAdd={mockup.quickAdd ?? null}>
        <Shell mockup={mockup} reduced={reduced} onReducedChange={setReduced}>
          {children}
        </Shell>
      </MockStateProvider>
    </ProposedThemeScope>
  );
}

function Shell({ mockup, reduced, onReducedChange, children }: { mockup: Mockup; reduced: boolean; onReducedChange: (on: boolean) => void; children: ReactNode }) {
  const { toast, hideToast, openQuickAdd } = useMockState();
  // Desktop: N opens quick add, except while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== "n" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      event.preventDefault();
      openQuickAdd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openQuickAdd]);

  return (
    <>
      <MockupCaption mockup={mockup} reduced={reduced} onReducedChange={onReducedChange} />
      <Flex maxW="1440px" mx="auto">
        <Sidebar active={mockup.sidebar} />
        <Box
          as="main"
          flex="1"
          minW="0"
          px={PROPOSED_SPACING.pageX}
          pt={PROPOSED_SPACING.pageTop}
          pb={{ base: "calc(7rem + env(safe-area-inset-bottom))", md: "10" }}
        >
          <Box maxW="72rem" mx="auto">
            {children}
          </Box>
        </Box>
      </Flex>
      <BottomBar active={mockup.tab} />
      <QuickAddSheet />
      <UndoToast
        message={toast?.message ?? null}
        action={toast?.action}
        onAction={() => {
          toast?.onAction?.();
          hideToast();
        }}
      />
    </>
  );
}

/** What this mockup is and its tap counts against the plan's targets. Not part of the design. */
function MockupCaption({ mockup, reduced, onReducedChange }: { mockup: Mockup; reduced: boolean; onReducedChange: (on: boolean) => void }) {
  return (
    <Box as="aside" aria-label="About this mockup" bg="bg.muted" borderBottomWidth="1px" borderColor="border" px={PROPOSED_SPACING.pageX} py="2">
      <Stack gap="1" maxW="1440px" mx="auto">
        <Flex gap="3" align="center" wrap="wrap">
          <Text textStyle="label">
            U3 mockup · {mockup.title}
          </Text>
          <Text textStyle="caption">Fixtures only; nothing is saved.</Text>
          <Box flex="1" />
          <NextLink href="/dev/preview/mockups">
            <Text as="span" textStyle="caption" color="fg.accent">
              All mockups
            </Text>
          </NextLink>
          <Switch.Root size="sm" checked={reduced} onCheckedChange={({ checked }) => onReducedChange(checked)}>
            <Switch.HiddenInput />
            <Switch.Control />
            <Switch.Label textStyle="caption">Reduced motion</Switch.Label>
          </Switch.Root>
        </Flex>
        <Box as="ul" listStyleType="none" m="0" p="0" display="grid" gap="0.5" gridTemplateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }}>
          {mockup.taps.map((tap) => (
            <Text as="li" key={tap.task} textStyle="caption" color="fg">
              <Text as="span" fontWeight="semibold">
                {tap.task}:
              </Text>{" "}
              today {tap.today} → <Text as="span" color="fg.accent" fontWeight="semibold">{tap.here}</Text>
              {tap.target ? ` · target ${tap.target}` : null}
            </Text>
          ))}
        </Box>
      </Stack>
    </Box>
  );
}

type SidebarLink = { key: SidebarItem; label: string; icon: LucideIcon; href?: MockupId; badge?: number };
const SIDEBAR: { label?: string; items: SidebarLink[] }[] = [
  { items: [{ key: "home", label: "Home", icon: House, href: "home" }] },
  {
    label: "Money",
    items: [
      { key: "expenses", label: "Expenses", icon: CreditCard, href: "money-expenses" },
      { key: "investments", label: "Investments", icon: TrendingUp },
      { key: "netWorth", label: "Net worth", icon: Scale },
    ],
  },
  {
    label: "Planning",
    items: [
      { key: "reminders", label: "Reminders", icon: BellRing, href: "planning-reminders", badge: 2 },
      { key: "todos", label: "To-dos", icon: SquareKanban, href: "planning-todos" },
      { key: "calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  { label: "More", items: [{ key: "settings", label: "Settings", icon: Settings2, href: "settings-account" }] },
];

/** The desktop sidebar, in the same five groups as the bottom bar, with quick add at the top. */
function Sidebar({ active }: { active: SidebarItem }) {
  const { openQuickAdd } = useMockState();
  return (
    <Stack
      as="nav"
      aria-label="Primary navigation"
      display={{ base: "none", md: "flex" }}
      width="15rem"
      flexShrink="0"
      position="sticky"
      top="0"
      height="100dvh"
      gap="5"
      px="3.5"
      py="5"
      bg="bg.subtle"
      borderRightWidth="1px"
      borderColor="border"
    >
      <Box px="2">
        <Brand />
      </Box>
      <Button size="md" bg="fg.accent" color="bg.surface" _hover={{ bg: "brand.fg" }} onClick={() => openQuickAdd()}>
        <Plus size={ICON.sm} aria-hidden="true" /> Add
        <Box as="kbd" fontFamily="mono" textStyle="xs" px="1.5" borderRadius="badge" bg="whiteAlpha.300">
          N
        </Box>
      </Button>
      {SIDEBAR.map((group, index) => (
        <Stack key={group.label ?? index} gap="0.5">
          {group.label ? (
            <Text textStyle="label" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" px="2.5" pb="1">
              {group.label}
            </Text>
          ) : null}
          {group.items.map((item) => (
            <SidebarEntry key={item.key} item={item} active={item.key === active} />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

function SidebarEntry({ item, active }: { item: SidebarLink; active: boolean }) {
  const content = (
    <Flex
      align="center"
      gap="2.5"
      px="2.5"
      py="2"
      borderRadius={radius("control")}
      color={active ? "fg.accent" : item.href ? "fg.muted" : "fg.subtle"}
      bg={active ? "bg.selected" : undefined}
      fontWeight="medium"
      transition={transition("background-color, color", "fast")}
      _hover={item.href ? { bg: active ? "bg.selected" : "bg.muted", color: active ? "fg.accent" : "fg" } : undefined}
    >
      <item.icon size={ICON.nav} aria-hidden="true" />
      <Text as="span" textStyle="body" fontWeight="medium" flex="1">
        {item.label}
      </Text>
      {item.badge ? (
        <Box as="span" textStyle="xs" fontWeight="semibold" px="2" borderRadius={radius("pill")} bg="fg.error" color="bg.surface">
          {item.badge}
        </Box>
      ) : null}
    </Flex>
  );
  if (!item.href) return <Box title="Not mocked in U3">{content}</Box>;
  return (
    <NextLink href={mockupHref(item.href)} aria-current={active ? "page" : undefined}>
      {content}
    </NextLink>
  );
}

const TABS: { key: BarTab; label: string; icon: LucideIcon; href: MockupId }[] = [
  { key: "home", label: "Home", icon: House, href: "home" },
  { key: "money", label: "Money", icon: WalletCards, href: "money-expenses" },
  { key: "planning", label: "Planning", icon: LayoutGrid, href: "planning-reminders" },
  { key: "more", label: "More", icon: MoreHorizontal, href: "more" },
];

/** Home, Money, +, Planning, More, with an indicator that slides under the active tab. */
function BottomBar({ active }: { active: BarTab }) {
  const { quickAdd, openQuickAdd, closeQuickAdd } = useMockState();
  // The + sits in the middle column, so tabs 3 and 4 move one column right.
  const column = (index: number) => (index < 2 ? index : index + 1);
  const activeIndex = TABS.findIndex((tab) => tab.key === active);
  return (
    <Grid
      as="nav"
      aria-label="Primary navigation"
      display={{ base: "grid", md: "none" }}
      position="fixed"
      insetX="0"
      bottom="0"
      zIndex="sticky"
      templateColumns="repeat(5, minmax(0, 1fr))"
      alignItems="center"
      height="calc(4.5rem + env(safe-area-inset-bottom))"
      pb="env(safe-area-inset-bottom)"
      px="2"
      bg="bg.surface"
      borderTopWidth="1px"
      borderColor="border"
    >
      <Box
        position="absolute"
        top="2"
        left="2"
        width="calc((100% - 1rem) / 5)"
        height="8"
        display="flex"
        justifyContent="center"
        pointerEvents="none"
        transform={`translateX(${column(activeIndex) * 100}%)`}
        transition={transition("transform", "moderate")}
        aria-hidden="true"
      >
        <Box width="3.25rem" height="full" borderRadius={radius("pill")} bg="bg.selected" />
      </Box>
      {TABS.map((tab, index) => {
        const on = tab.key === active;
        return (
          <NextLink
            key={tab.key}
            href={mockupHref(tab.href)}
            aria-current={on ? "page" : undefined}
            style={{ gridColumn: column(index) + 1, gridRow: 1, position: "relative" }}
          >
            <Stack align="center" gap="1" pt="1" color={on ? "fg" : "fg.subtle"} data-pressable="icon">
              <tab.icon size={22} aria-hidden="true" />
              <Text as="span" fontSize="2xs" lineHeight="0.875rem" fontWeight="medium">
                {tab.label}
              </Text>
            </Stack>
          </NextLink>
        );
      })}
      <Box
        as="button"
        gridColumn="3"
        gridRow="1"
        justifySelf="center"
        mt="-5"
        boxSize="3.25rem"
        display="grid"
        placeItems="center"
        borderRadius={radius("card")}
        bg="fg.accent"
        color="bg.surface"
        boxShadow="overlay"
        data-pressable="icon"
        aria-label={quickAdd ? "Close quick add" : "Quick add"}
        aria-expanded={Boolean(quickAdd)}
        onClick={() => (quickAdd ? closeQuickAdd() : openQuickAdd())}
      >
        <Box transform={quickAdd ? "rotate(45deg)" : "none"} transition={transition("transform", "moderate")} display="grid">
          <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
        </Box>
      </Box>
    </Grid>
  );
}

"use client";

import { Box, chakra, Grid, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import Link from "next/link";

import { NavBadge, remindersBadgeLabel } from "@/components/layout/nav-badge";
import { activeSection } from "@/components/layout/nav-items";
import { useQuickAdd } from "@/components/quick-add/quick-add-provider";
import { useAppPathname } from "@/components/layout/use-app-pathname";
import { useNavigation } from "@/components/layout/use-navigation";
import { useReminderBadge } from "@/components/reminders/use-reminder-badge";
import { ICON_STROKE } from "@/components/ui/icon";
import { PRESS_SCALE, pressFeedback, transition } from "@/components/ui/theme/motion";

/**
 * Fixed bottom navigation on phones: Home, Money, +, Planning, More, with the + in the middle
 * column. The tabs follow `navigationFor` (Money is missing for a kid with every money module off),
 * and the + stays the middle of what's left. A tab holding Reminders carries its count on the icon,
 * so what's due shows without opening Planning. The indicator slides under the active tab.
 */
export function MobileTabBar() {
  const pathname = useAppPathname();
  const { sections } = useNavigation();
  const quickAdd = useQuickAdd();
  const reminders = useReminderBadge();
  const active = activeSection(sections, pathname);
  const middle = Math.ceil(sections.length / 2);
  // The + takes a column between the tabs; tabs after it move one column right.
  const column = (index: number) => (index < middle ? index : index + 1);
  const activeIndex = sections.findIndex((section) => section === active);
  const add = (
    <chakra.button
      key="add"
      type="button"
      gridColumn={middle + 1}
      gridRow="1"
      justifySelf="center"
      mt="-5"
      boxSize="3.25rem"
      display="grid"
      placeItems="center"
      borderRadius="card"
      bg="fg.accent"
      color="bg.surface"
      boxShadow="overlay"
      css={pressFeedback(PRESS_SCALE.icon)}
      aria-label="Quick add"
      aria-haspopup="dialog"
      onClick={() => quickAdd.open()}
    >
      <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
    </chakra.button>
  );
  return (
    <Grid
      as="nav"
      aria-label="Primary navigation"
      position="fixed"
      bottom="0"
      insetX="0"
      zIndex="docked"
      display={{ base: "grid", md: "none" }}
      templateColumns={`repeat(${sections.length + 1}, minmax(0, 1fr))`}
      alignItems="center"
      height="calc(4.5rem + env(safe-area-inset-bottom))"
      pb="env(safe-area-inset-bottom)"
      px="2"
      bg="bg.surface"
      borderTopWidth="1px"
      borderColor="border"
    >
      {activeIndex >= 0 ? (
        <Box
          position="absolute"
          top="2"
          left="2"
          width={`calc((100% - 1rem) / ${sections.length + 1})`}
          height="8"
          display="flex"
          justifyContent="center"
          pointerEvents="none"
          transform={`translateX(${column(activeIndex) * 100}%)`}
          transition={transition("transform", "moderate")}
          aria-hidden="true"
        >
          <Box width="3.25rem" height="full" borderRadius="pill" bg="bg.selected" />
        </Box>
      ) : null}
      {sections.flatMap((section, index) => {
        const on = section === active;
        const Icon = section.icon;
        const badged = section.items.some((item) => item.badge === "reminders");
        const tab = (
          <ChakraLink
            key={section.key}
            asChild
            position="relative"
            display="block"
            gridColumn={column(index) + 1}
            gridRow="1"
            minW="0"
            textDecoration="none"
            borderRadius="control"
            _hover={{ textDecoration: "none" }}
            _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "-2px" }}
          >
            <Link href={section.href} aria-current={on ? "page" : undefined}>
              <Stack align="center" gap="1" pt="1" color={on ? "fg" : "fg.subtle"} css={pressFeedback(PRESS_SCALE.icon)}>
                <Icon size={22} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <Text as="span" fontSize="2xs" lineHeight="0.875rem" fontWeight="medium">
                  {section.label}
                </Text>
              </Stack>
              {badged ? (
                <NavBadge dot count={reminders.count} overdue={reminders.overdue} srLabel={remindersBadgeLabel(reminders.count)} />
              ) : null}
            </Link>
          </ChakraLink>
        );
        // The + sits between the tabs in the DOM too, so the tab order matches what's on screen.
        return index === middle - 1 ? [tab, add] : [tab];
      })}
    </Grid>
  );
}

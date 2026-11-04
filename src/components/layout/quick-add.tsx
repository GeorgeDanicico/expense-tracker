"use client";

import { Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";

import { NAV_ITEMS } from "@/components/layout/nav-items";
import { useNavigation } from "@/components/layout/use-navigation";
import { AppDialog } from "@/components/ui/app-dialog";

const QuickAddContext = createContext<{ open: () => void }>({ open: () => undefined });

/** Opens the quick-add sheet: the + in the bottom bar and Add at the top of the sidebar. */
export function useQuickAdd() {
  return useContext(QuickAddContext);
}

const ADD_FROM = [NAV_ITEMS.expenses, NAV_ITEMS.reminders, NAV_ITEMS.todos, NAV_ITEMS.calendar];

/**
 * The sheet behind every + / Add. Until U6 builds the quick-add forms it says so and links to the
 * pages that add things today.
 */
function QuickAddPlaceholder({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { sections } = useNavigation();
  const visible = new Set(sections.flatMap((section) => section.items.map((item) => item.href)));
  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="Quick add" size="sm" closeLabel="Close quick add">
      <Stack gap="3">
        <Text textStyle="body" color="fg.muted">
          Adding from anywhere is coming soon. For now, add from one of these pages:
        </Text>
        <Stack gap="1">
          {ADD_FROM.filter((item) => visible.has(item.href)).map((item) => (
            <ChakraLink key={item.href} asChild minH="11" display="flex" alignItems="center" fontWeight="medium" color="fg.accent">
              <NextLink href={item.href} onClick={() => onOpenChange(false)}>
                {item.label}
              </NextLink>
            </ChakraLink>
          ))}
        </Stack>
      </Stack>
    </AppDialog>
  );
}

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <QuickAddContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <QuickAddPlaceholder open={open} onOpenChange={setOpen} />
    </QuickAddContext.Provider>
  );
}

"use client";

import { Box, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { BellRing, Car, Gift, GraduationCap, Pencil, Stethoscope, Trash2, type LucideIcon } from "lucide-react";
import NextLink from "next/link";
import type { ReactNode } from "react";

import { CATEGORY_ICONS } from "@/components/expenses/category-visual";
import { Amount, Collapse, IconTile, RowActions } from "@/components/ui";
import { CATEGORY_LABELS } from "@/lib/expenses/categories";

import { useMockState } from "./mock-state";
import { MOCK_CURRENCY, memberById, type MockExpense, type MockReminder } from "./mockup-data";
import { mockupHref, type MockupId } from "./mockups";
import { MockRow } from "./stand-ins";

/** The page's title, with at most one action next to it. */
export function PageTitle({ title, kicker, action }: { title: string; kicker?: string; action?: ReactNode }) {
  return (
    <Flex align="center" justify="space-between" gap="3" minH="11">
      <Box minW="0">
        {kicker ? (
          <Text textStyle="bodySm" color="fg.muted">
            {kicker}
          </Text>
        ) : null}
        <Heading as="h1" size="xl" truncate>
          {title}
        </Heading>
      </Box>
      {action}
    </Flex>
  );
}

/** "Insights", "All reminders": a card's link to its section. */
export function SectionLink({ href, children }: { href: MockupId; children: ReactNode }) {
  return (
    <NextLink href={mockupHref(href)}>
      <Text as="span" textStyle="bodySm" fontWeight="medium" color="fg.accent" px="1.5" py="1">
        {children}
      </Text>
    </NextLink>
  );
}

/** A small uppercase label above a group of rows ("Yesterday", "Upcoming"). */
export function GroupLabel({ children, px = "2" }: { children: ReactNode; px?: string }) {
  return (
    <Text textStyle="label" color="fg.subtle" textTransform="uppercase" letterSpacing="0.04em" px={px} pt="2" pb="1">
      {children}
    </Text>
  );
}

export function MemberDot({ id }: { id: string }) {
  const member = memberById(id);
  return (
    <Flex as="span" display="inline-flex" align="center" gap="1.5">
      <Box as="span" boxSize="2" borderRadius="full" bg={`member.${member.slot}`} aria-hidden="true" />
      {member.name}
    </Flex>
  );
}

/** Rows in a column with room between them and no lines. */
export function Rows({ children }: { children: ReactNode }) {
  return <Stack gap="0.5">{children}</Stack>;
}

export function CategoryTile({ category }: { category: MockExpense["category"] }) {
  return <IconTile icon={CATEGORY_ICONS[category]} bg={`category.${category}.bg`} color={`category.${category}.fg`} />;
}

/**
 * One expense, as Home and Money show it: collapses out on delete and slides in when just added.
 * Home shows who and when; Money (grouped by day, one member at a time) shows the category.
 * `wrap` puts a swipe around it on Money.
 */
export function ExpenseRow({
  expense,
  showMember = true,
  phoneMenu = true,
  wrap,
}: {
  expense: MockExpense;
  showMember?: boolean;
  phoneMenu?: boolean;
  wrap?: (row: ReactNode) => ReactNode;
}) {
  const { added, removed, removeExpense, restoreExpense, showToast } = useMockState();
  const remove = () => {
    removeExpense(expense.id);
    showToast({ message: "Expense deleted", action: "Undo", onAction: () => restoreExpense(expense.id) });
  };
  const row = (
    <MockRow
      leading={<CategoryTile category={expense.category} />}
      title={expense.description}
      meta={
        showMember ? (
          <Flex as="span" gap="1" align="center">
            <MemberDot id={expense.member} />
            <span aria-hidden="true">·</span>
            {expense.day}
          </Flex>
        ) : (
          CATEGORY_LABELS[expense.category]
        )
      }
      trailing={
        <>
          <RowActions
            label={expense.description}
            phoneMenu={phoneMenu}
            actions={[
              { label: "Edit", icon: Pencil, onSelect: () => showToast({ message: "Edit opens the expense form (U8)" }) },
              { label: "Delete", icon: Trash2, onSelect: remove, tone: "danger" },
            ]}
          />
          <Amount value={expense.amount} currency={MOCK_CURRENCY} size="sm" />
        </>
      }
    />
  );
  return (
    <Collapse open={!removed.has(expense.id)} entering={added.has(expense.id)}>
      {wrap ? wrap(row) : row}
    </Collapse>
  );
}

const REMINDER_ICONS: Record<MockReminder["kind"], LucideIcon> = {
  bill: BellRing,
  appointment: Stethoscope,
  car: Car,
  gift: Gift,
  school: GraduationCap,
};

export function ReminderTile({ reminder }: { reminder: MockReminder }) {
  const tone = reminder.overdue ? "error" : reminder.group === "Today" ? "info" : null;
  return (
    <IconTile
      icon={REMINDER_ICONS[reminder.kind]}
      bg={tone ? `bg.${tone}` : "bg.muted"}
      color={tone ? `fg.${tone}` : "fg.muted"}
    />
  );
}

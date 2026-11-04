"use client";

import { Box, Button, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Car, Pencil, ShoppingBasket, Trash2, Utensils, type LucideIcon } from "lucide-react";
import { useState } from "react";

import {
  ActionBar,
  Amount,
  AmountInput,
  Collapse,
  Disclosure,
  FormField,
  IconTile,
  ListRow,
  RowActions,
  ToggleChip,
  UndoToast,
  useRowActions,
  useUndo,
} from "@/components/ui";

import { GalleryRow, GallerySection } from "./gallery-section";

type Sample = { id: number; title: string; meta: string; amount: number; icon: LucideIcon; tone: "groceries" | "transport" | "dining" };

const SAMPLES: Sample[] = [
  { id: 1, title: "Weekly groceries", meta: "Groceries · Today", amount: 84.2, icon: ShoppingBasket, tone: "groceries" },
  { id: 2, title: "Metro card", meta: "Transport · Yesterday", amount: 25, icon: Car, tone: "transport" },
  { id: 3, title: "Lunch with Ana", meta: "Dining · Mon 2", amount: 38.5, icon: Utensils, tone: "dining" },
];

/** U4's mobile primitives: row actions with undo, the amount input, chips, disclosure, the action bar. */
export function MobileGallery() {
  return (
    <GallerySection
      title="Mobile primitives"
      description="RowActions (⋯ on phones, long-press too; icons on hover on desktop), UndoToast (5 s, the write is sent only when it expires), AmountInput, ToggleChip, Disclosure, ActionBar, IconTile. 44px touch targets below 768px."
    >
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="6">
        <RowsWithUndo />
        <Stack gap="4">
          <GalleryRow label="AmountInput hero">
            <AmountDemo />
          </GalleryRow>
          <FormField label="Amount (field)" hint="Decimal keypad, two decimals at most; a comma works.">
            <AmountInput currency="RON" name="amount" defaultValue="12.5" />
          </FormField>
          <GalleryRow label="ToggleChip">
            <ChipsDemo />
          </GalleryRow>
          <Disclosure label="More details">
            <Text textStyle="bodySm" color="fg.muted">
              Notes, subtype and tab live here: what most entries don&apos;t need.
            </Text>
          </Disclosure>
        </Stack>
      </SimpleGrid>
      <ActionBarDemo />
    </GallerySection>
  );
}

function RowsWithUndo() {
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  const [sent, setSent] = useState<string[]>([]);
  const undo = useUndo();
  const setRow = (id: number, hidden: boolean) =>
    setGone((ids) => {
      const next = new Set(ids);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Stack gap="2" position="relative" minH="80" pb="20">
      <Box as="ul">
        {SAMPLES.map((sample) => (
          <Collapse as="li" key={sample.id} open={!gone.has(sample.id)}>
            <SampleRow
              sample={sample}
              onDelete={() => {
                setRow(sample.id, true);
                undo.schedule({
                  message: `${sample.title} deleted`,
                  commit: () => setSent((list) => [...list, sample.title]),
                  restore: () => setRow(sample.id, false),
                });
              }}
            />
          </Collapse>
        ))}
      </Box>
      <Text textStyle="caption">Sent to the API: {sent.length ? sent.join(", ") : "nothing yet"}</Text>
      <Button size="xs" variant="ghost" alignSelf="flex-start" onClick={() => setGone(new Set())}>
        Bring them back
      </Button>
      <UndoToast contained {...undo.toast} />
    </Stack>
  );
}

function SampleRow({ sample, onDelete }: { sample: Sample; onDelete: () => void }) {
  const { rowProps, menu } = useRowActions();
  return (
    <ListRow
      as="div"
      {...rowProps}
      leading={<IconTile icon={sample.icon} bg={`category.${sample.tone}.bg`} color={`category.${sample.tone}.fg`} />}
      title={sample.title}
      meta={sample.meta}
      trailing={<Amount value={sample.amount} currency="EUR" size="sm" />}
      actions={
        <RowActions
          label={sample.title}
          {...menu}
          actions={[
            { label: "Edit", icon: Pencil, onSelect: () => undefined },
            { label: "Delete", icon: Trash2, onSelect: onDelete, tone: "danger" },
          ]}
        />
      }
    />
  );
}

function AmountDemo() {
  const [amount, setAmount] = useState("12.50");
  return <AmountInput variant="hero" currency="EUR" value={amount} onValueChange={setAmount} />;
}

const CHIPS = ["Groceries", "Dining", "Transport"];

function ChipsDemo() {
  const [on, setOn] = useState("Groceries");
  return (
    <Flex gap="2" wrap="wrap">
      {CHIPS.map((chip) => (
        <ToggleChip key={chip} pressed={chip === on} onClick={() => setOn(chip)}>
          {chip}
        </ToggleChip>
      ))}
      <ToggleChip selected>Today ▾</ToggleChip>
      <ToggleChip disabled>Disabled</ToggleChip>
    </Flex>
  );
}

function ActionBarDemo() {
  return (
    <Stack gap="2">
      <Text textStyle="label">ActionBar (scroll the box: it stays at the bottom; on a phone it sits on the bottom bar)</Text>
      <Box height="48" overflowY="auto" bg="bg.canvas" borderRadius="card" p="3">
        <Stack gap="2" pb="3">
          {Array.from({ length: 8 }, (_, index) => (
            <Text key={index} textStyle="bodySm" color="fg.muted">
              Row {index + 1} of the import review
            </Text>
          ))}
        </Stack>
        <ActionBar aria-label="Import actions">
          <Flex align="center" justify="space-between" gap="3">
            <Text textStyle="bodySm" fontWeight="medium">
              12 of 14 rows selected
            </Text>
            <Button variant="solid" colorPalette="brand" size="md">
              Add 12 expenses
            </Button>
          </Flex>
        </ActionBar>
      </Box>
    </Stack>
  );
}

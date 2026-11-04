"use client";

import { Box, Button, Flex, Grid, SimpleGrid, Stack, Switch, Text } from "@chakra-ui/react";
import { BellRing, House, LayoutGrid, MoreHorizontal, Plus, ShoppingBasket, Trash2, WalletCards } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Amount, ICON, IconButton, SegmentedControl } from "@/components/ui";
import { formatCurrency } from "@/lib/utils/currency";

import { ProposedThemeScope, useCountUp } from "../preview/mockups/motion-scope";
import { PROPOSED_TEXT, radius, transition } from "../preview/mockups/proposed-theme";
import { BottomSheet, Chip, CollapseRow, IconTile, MockRow, SaveButton, STATUS_SURFACE, UndoToast, useSaveCheck } from "../preview/mockups/stand-ins";
import { GallerySection } from "./gallery-section";

/**
 * Every proposed animation, to judge "a little more animated" by feel. The values are U3's
 * proposals for U4 (src/app/dev/preview/mockups/proposed-theme.ts), not theme tokens yet.
 */
export function MotionGallery() {
  const [reduced, setReduced] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <Box id="motion">
      <ProposedThemeScope reduced={reduced}>
        <GallerySection
          title="Motion"
          description="Proposed for U4: press 90 ms, fast 120, moderate 200, slow 300; standard, enter and exit easings. Only transform and opacity move, except the row collapse. Reduced motion makes every change instant; the action still happens."
        >
          <Flex gap="4" align="center" wrap="wrap">
            <Switch.Root checked={reduced} onCheckedChange={({ checked }) => setReduced(checked)}>
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label>Simulate reduced motion</Switch.Label>
            </Switch.Root>
            <Button size="sm" onClick={() => setRound(round + 1)}>
              Replay
            </Button>
          </Flex>
          <SimpleGrid key={round} columns={{ base: 1, md: 2, xl: 3 }} gap="4">
            <Demo title="Sheet slides up" tokens="open: slow · enter · close: slow · exit · scrim: moderate">
              <SheetDemo />
            </Demo>
            <Demo title="Press" tokens="press · standard · scale 0.97 (chips 0.95, icons 0.92)">
              <PressDemo />
            </Demo>
            <Demo title="Rows in and out" tokens="in: slow · enter · out: moderate · standard (grid rows) · toast: moderate">
              <RowsDemo />
            </Demo>
            <Demo title="Indicators slide" tokens="moderate · standard">
              <IndicatorDemo />
            </Demo>
            <Demo title="Save check" tokens="check: slow · enter (scale and fade) · colour: press">
              <SaveDemo />
            </Demo>
            <Demo title="Count-up" tokens="countUp 450 ms · ease-out (JavaScript; instant with reduced motion)">
              <CountUpDemo />
            </Demo>
          </SimpleGrid>
        </GallerySection>
      </ProposedThemeScope>
    </Box>
  );
}

function Demo({ title, tokens, children }: { title: string; tokens: string; children: ReactNode }) {
  return (
    <Stack gap="2">
      <Box position="relative" overflow="hidden" height="64" bg="bg.canvas" borderRadius={radius("card")} p="4">
        {children}
      </Box>
      <Text textStyle="label">{title}</Text>
      <Text textStyle="caption">{tokens}</Text>
    </Stack>
  );
}

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="md" variant="solid" colorPalette="brand" onClick={() => setOpen(true)}>
        Open the sheet
      </Button>
      <BottomSheet contained open={open} onClose={() => setOpen(false)} label="Example sheet">
        <Text textStyle="dialogTitle">A bottom sheet</Text>
        <Text textStyle="bodySm" color="fg.muted">
          Tap outside or press Escape to close.
        </Text>
        <Button size="md" variant="solid" colorPalette="brand" onClick={() => setOpen(false)}>
          Done
        </Button>
      </BottomSheet>
    </>
  );
}

function PressDemo() {
  return (
    <Stack gap="3" align="flex-start">
      <Flex gap="2" align="center" wrap="wrap">
        <Button size="md" variant="solid" colorPalette="brand">
          Hold me
        </Button>
        <Chip pressed={false}>A chip</Chip>
        <Box as="button" data-pressable="icon" boxSize="11" display="grid" placeItems="center" borderRadius={radius("card")} bg="fg.accent" color="bg.surface" aria-label="Quick add">
          <Plus size={22} aria-hidden="true" />
        </Box>
      </Flex>
      <Box as="button" data-pressable width="full" textAlign="start">
        <MockRow leading={<IconTile icon={ShoppingBasket} bg="category.groceries.bg" color="category.groceries.fg" />} title="A row" meta="Rows press too" />
      </Box>
    </Stack>
  );
}

const SAMPLE_ROWS = ["Weekly groceries", "Metro card", "Rent"];

function RowsDemo() {
  const [rows, setRows] = useState(SAMPLE_ROWS.map((title, index) => ({ id: index, title, fresh: false })));
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  const [last, setLast] = useState<number | null>(null);
  const add = () => setRows((list) => [{ id: list.length, title: `Coffee ${list.length - SAMPLE_ROWS.length + 1}`, fresh: true }, ...list].slice(0, 4));
  return (
    <Stack gap="2">
      <Button size="sm" alignSelf="flex-start" onClick={add}>
        Add a row
      </Button>
      <Stack gap="0.5">
        {rows.map((row) => (
          <CollapseRow key={row.id} gone={gone.has(row.id)} entering={row.fresh}>
            <MockRow
              title={row.title}
              trailing={
                <IconButton aria-label={`Delete ${row.title}`} tone="danger" onClick={() => {
                    setGone((ids) => new Set(ids).add(row.id));
                    setLast(row.id);
                  }}
                >
                  <Trash2 size={ICON.sm} />
                </IconButton>
              }
            />
          </CollapseRow>
        ))}
      </Stack>
      <UndoToast
        contained
        message={last === null ? null : "Deleted"}
        action="Undo"
        onAction={() => {
          setGone((ids) => new Set([...ids].filter((id) => id !== last)));
          setLast(null);
        }}
      />
    </Stack>
  );
}

const TABS = [
  { label: "Home", icon: House },
  { label: "Money", icon: WalletCards },
  { label: "Planning", icon: LayoutGrid },
  { label: "More", icon: MoreHorizontal },
];

function IndicatorDemo() {
  const [segment, setSegment] = useState("reminders");
  const [tab, setTab] = useState(0);
  return (
    <Stack gap="6">
      <SegmentedControl
        aria-label="Example segments"
        fullWidth
        value={segment}
        onValueChange={setSegment}
        items={[
          { value: "reminders", label: "Reminders" },
          { value: "todos", label: "To-dos" },
          { value: "calendar", label: "Calendar" },
        ]}
      />
      <Grid position="relative" templateColumns="repeat(4, minmax(0, 1fr))" bg="bg.surface" borderRadius={radius("card")} py="2">
        <Flex
          position="absolute"
          top="2"
          left="0"
          width="25%"
          height="8"
          justify="center"
          transform={`translateX(${tab * 100}%)`}
          transition={transition("transform", "moderate")}
          aria-hidden="true"
        >
          <Box width="3.25rem" height="full" borderRadius={radius("pill")} bg="bg.selected" />
        </Flex>
        {TABS.map((item, index) => (
          <Stack
            key={item.label}
            as="button"
            position="relative"
            align="center"
            gap="1"
            pt="1"
            data-pressable="icon"
            color={index === tab ? "fg" : "fg.subtle"}
            aria-pressed={index === tab}
            onClick={() => setTab(index)}
          >
            <item.icon size={22} aria-hidden="true" />
            <Text as="span" fontSize="2xs" fontWeight="medium">
              {item.label}
            </Text>
          </Stack>
        ))}
      </Grid>
    </Stack>
  );
}

function SaveDemo() {
  const { saved, save } = useSaveCheck(() => undefined);
  return (
    <Stack gap="3">
      <MockRow leading={<IconTile icon={BellRing} bg={STATUS_SURFACE.info} color="fg.info" />} title="Renew car insurance" meta="Tomorrow, 9:00" />
      <Flex>
        <SaveButton saved={saved} onClick={save}>
          Save reminder
        </SaveButton>
      </Flex>
    </Stack>
  );
}

function CountUpDemo() {
  const [total, setTotal] = useState(947.65);
  const shown = useCountUp(total, 0);
  return (
    <Stack gap="3">
      <Text textStyle="label" color="fg.muted">
        Spent in November
      </Text>
      <Text {...PROPOSED_TEXT.hero} fontVariantNumeric="tabular-nums">
        {formatCurrency(shown, "EUR")}
      </Text>
      <Flex gap="2" wrap="wrap">
        <Button size="sm" onClick={() => setTotal(total + 12.5)}>
          Add <Amount value={12.5} currency="EUR" size="sm" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setTotal(Math.max(0, total - 12.5))}>
          Take it back
        </Button>
      </Flex>
    </Stack>
  );
}

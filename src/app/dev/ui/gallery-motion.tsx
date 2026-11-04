"use client";

import { Box, Button, chakra, Flex, Grid, Input, SimpleGrid, Stack, Switch, Text } from "@chakra-ui/react";
import { BellRing, House, LayoutGrid, MoreHorizontal, Plus, ShoppingBasket, Trash2, WalletCards } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Amount, AppDialog, Collapse, FormActions, ICON, IconButton, IconTile, SegmentedControl, ToggleChip, UndoToast } from "@/components/ui";
import { DURATION_MS, PRESS_SCALE, pressFeedback, transition } from "@/components/ui/theme/motion";
import { rowRecipe } from "@/components/ui/theme/recipes/misc";
import { formatCurrency } from "@/lib/utils/currency";

import { MotionScope, useCountUp } from "../preview/mockups/motion-scope";
import { MockRow, SaveButton, useSaveCheck } from "../preview/mockups/stand-ins";
import { GallerySection } from "./gallery-section";

const MS = DURATION_MS;

/**
 * Every animation, on the theme's motion tokens (src/components/ui/theme/motion.ts), to judge "a
 * little more animated" by feel.
 */
export function MotionGallery() {
  const [reduced, setReduced] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <Box id="motion">
      <MotionScope reduced={reduced}>
        <GallerySection
          title="Motion"
          description={`Theme tokens: press ${MS.press} ms, fast ${MS.fast}, moderate ${MS.moderate}, slow ${MS.slow}, countUp ${MS.countUp}; standard, enter and exit easings. Only transform and opacity move, except the row collapse. Reduced motion (the device setting, or the switch for everything but the portalled sheet) makes every change instant; the action still happens.`}
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
            <Demo title="Sheet slides up (dialog on desktop)" tokens="phone: slow · enter / slow · exit · desktop: pop-in, moderate · scrim: moderate">
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
      </MotionScope>
    </Box>
  );
}

function Demo({ title, tokens, children }: { title: string; tokens: string; children: ReactNode }) {
  return (
    <Stack gap="2">
      <Box position="relative" overflow="hidden" height="64" bg="bg.canvas" borderRadius="card" p="4">
        {children}
      </Box>
      <Text textStyle="label">{title}</Text>
      <Text textStyle="caption">{tokens}</Text>
    </Stack>
  );
}

function SheetDemo() {
  return (
    <AppDialog
      title="A bottom sheet"
      description="Swipe it down, tap outside or press Escape. Type something first and it asks."
      trigger={
        <Button size="md" variant="solid" colorPalette="brand">
          Open the sheet
        </Button>
      }
      footer={<FormActions submitLabel="Done" closesDialog onSubmit={() => undefined} />}
    >
      <Input size="md" aria-label="Something to type" placeholder="Type to make it dirty" />
    </AppDialog>
  );
}

const PressRow = chakra("button", rowRecipe);

function PressDemo() {
  return (
    <Stack gap="3" align="flex-start">
      <Flex gap="2" align="center" wrap="wrap">
        <Button size="md" variant="solid" colorPalette="brand">
          Hold me
        </Button>
        <ToggleChip>A chip</ToggleChip>
        <Box as="button" boxSize="11" display="grid" placeItems="center" borderRadius="card" bg="fg.accent" color="bg.surface" aria-label="Quick add" css={pressFeedback(PRESS_SCALE.icon)}>
          <Plus size={22} aria-hidden="true" />
        </Box>
      </Flex>
      <PressRow type="button" bg="bg.surface">
        <IconTile icon={ShoppingBasket} bg="category.groceries.bg" color="category.groceries.fg" />
        <Text textStyle="body" fontWeight="medium">
          A row presses too
        </Text>
      </PressRow>
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
          <Collapse key={row.id} open={!gone.has(row.id)} entering={row.fresh}>
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
          </Collapse>
        ))}
      </Stack>
      <UndoToast
        contained
        message={last === null ? null : "Deleted"}
        onUndo={() => {
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
      <Grid position="relative" templateColumns="repeat(4, minmax(0, 1fr))" bg="bg.surface" borderRadius="card" py="2">
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
          <Box width="3.25rem" height="full" borderRadius="pill" bg="bg.selected" />
        </Flex>
        {TABS.map((item, index) => (
          <Stack
            key={item.label}
            as="button"
            position="relative"
            align="center"
            gap="1"
            pt="1"
            css={pressFeedback(PRESS_SCALE.icon)}
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
      <MockRow leading={<IconTile icon={BellRing} bg="bg.info" color="fg.info" />} title="Renew car insurance" meta="Tomorrow, 9:00" />
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
      <Text textStyle="amountHero">
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

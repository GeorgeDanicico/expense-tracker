"use client";

import {
  Box,
  Button,
  Container,
  Input,
  InputGroup,
  NativeSelect,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Download, Inbox, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  Amount,
  AppDialog,
  Card,
  CategoryBadge,
  ConfirmDialog,
  EmptyState,
  FormActions,
  FormField,
  ICON,
  IconButton,
  InlineAlert,
  ListRow,
  PageHeader,
  SectionHeader,
  SegmentedControl,
  Stat,
  StatGroup,
  StatusBadge,
  Toolbar,
  ValueWithChange,
} from "@/components/ui";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";

import { GalleryRow, GallerySection } from "./gallery-section";
import { TokenSwatches, TypeScale } from "./gallery-tokens";

const SIZES = ["xs", "sm", "md"] as const;

export function UiGallery() {
  const [view, setView] = useState<"summary" | "monthly" | "history">("summary");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Container maxW="1200px" px={{ base: "4", md: "6" }} py={{ base: "5", md: "8" }}>
      <Stack gap={{ base: "4", md: "5" }}>
        <PageHeader
          title="UI gallery"
          description="Every primitive, size and tone. Development only."
          actions={
            <>
              <Button variant="solid" colorPalette="brand">
                <Plus size={ICON.sm} aria-hidden="true" /> Primary action
              </Button>
              <Button variant="ghost">
                <Download size={ICON.sm} aria-hidden="true" /> Export
              </Button>
            </>
          }
        />

        <GallerySection title="Buttons" description="xs 28px · sm 32px (default) · md 36px">
          {(["solid", "outline", "ghost", "subtle"] as const).map((variant) => (
            <GalleryRow key={variant} label={variant}>
              {SIZES.map((size) => (
                <Button
                  key={size}
                  size={size}
                  variant={variant}
                  colorPalette={variant === "solid" ? "brand" : undefined}
                >
                  <Plus aria-hidden="true" /> Button {size}
                </Button>
              ))}
            </GalleryRow>
          ))}
          <GalleryRow label="danger">
            {SIZES.map((size) => (
              <Button key={size} size={size} variant="solid" colorPalette="danger">
                Delete {size}
              </Button>
            ))}
            <Button variant="outline" colorPalette="danger">Outline danger</Button>
          </GalleryRow>
          <GalleryRow label="states">
            <Button loading variant="solid" colorPalette="brand">Saving</Button>
            <Button disabled>Disabled</Button>
          </GalleryRow>
          <GalleryRow label="IconButton">
            <IconButton aria-label="Edit (xs)" size="xs"><Pencil size={ICON.xs} /></IconButton>
            <IconButton aria-label="Edit (sm)"><Pencil size={ICON.sm} /></IconButton>
            <IconButton aria-label="Edit with tooltip" tooltip variant="outline"><Pencil size={ICON.sm} /></IconButton>
            <IconButton aria-label="Delete" tone="danger" size="xs"><Trash2 size={ICON.xs} /></IconButton>
          </GalleryRow>
        </GallerySection>

        <GallerySection title="Form controls" description="Inputs keep a 16px font below 768px to prevent iOS zoom.">
          {SIZES.map((size) => (
            <GalleryRow key={size} label={`size ${size}`}>
              <Input size={size} placeholder="Input" maxW="14rem" />
              <NativeSelect.Root size={size} maxW="12rem">
                <NativeSelect.Field defaultValue="groceries">
                  <option value="groceries">Groceries</option>
                  <option value="housing">Housing</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Button size={size}>Go</Button>
            </GalleryRow>
          ))}
          <GalleryRow label="search">
            <InputGroup maxW="18rem" startElement={<Search size={ICON.sm} aria-hidden="true" />}>
              <Input placeholder="Search expenses" />
            </InputGroup>
          </GalleryRow>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="3">
            <FormField label="Description" hint="Shown in the ledger.">
              <Input placeholder="e.g. Weekly groceries" />
            </FormField>
            <FormField label="Amount (EUR)" error="Enter an amount greater than zero.">
              <Input type="number" placeholder="0.00" />
            </FormField>
            <FormField label="Notes" optional>
              <Textarea rows={3} placeholder="Add an optional note" />
            </FormField>
            <FormField label="Label left on desktop" orientation={{ base: "vertical", md: "horizontal" }}>
              <Input placeholder="Horizontal field" />
            </FormField>
          </SimpleGrid>
          <FormActions submitLabel="Save expense" onCancel={() => undefined} onSubmit={() => undefined} />
        </GallerySection>

        <GallerySection title="Navigation" description="Tabs (line, subtle) and SegmentedControl.">
          <Tabs.Root defaultValue="main">
            <Tabs.List aria-label="Example tabs">
              <Tabs.Trigger value="main">Expenses</Tabs.Trigger>
              <Tabs.Trigger value="car">Car</Tabs.Trigger>
              <Tabs.Trigger value="travel">Travel 2026</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          <Tabs.Root defaultValue="main" variant="subtle">
            <Tabs.List aria-label="Example subtle tabs">
              <Tabs.Trigger value="main">Overview</Tabs.Trigger>
              <Tabs.Trigger value="other">Transactions</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          <GalleryRow label="sm / xs">
            <SegmentedControl
              aria-label="Dashboard view"
              value={view}
              onValueChange={setView}
              items={[
                { value: "summary", label: "Summary" },
                { value: "monthly", label: "Monthly" },
                { value: "history", label: "History" },
              ]}
            />
            <SegmentedControl
              aria-label="Period"
              size="xs"
              value="6m"
              onValueChange={() => undefined}
              items={[
                { value: "3m", label: "3M" },
                { value: "6m", label: "6M" },
                { value: "1y", label: "12M" },
                { value: "custom", label: "Custom" },
              ]}
            />
          </GalleryRow>
          <Toolbar aria-label="Example toolbar">
            <Input placeholder="Filter" maxW="12rem" />
            <Button size="xs" variant="solid" colorPalette="brand">Apply</Button>
            <Button size="xs" variant="ghost">Reset</Button>
          </Toolbar>
        </GallerySection>

        <GallerySection title="Badges">
          <GalleryRow label="StatusBadge">
            {(["positive", "negative", "warning", "info", "neutral", "brand"] as const).map((tone) => (
              <StatusBadge key={tone} tone={tone}>{tone}</StatusBadge>
            ))}
          </GalleryRow>
          <GalleryRow label="Category (subtle)">
            {EXPENSE_CATEGORIES.map((category) => <CategoryBadge key={category} category={category} />)}
            <CategoryBadge category="car" subtype="car_fuel" />
          </GalleryRow>
          <GalleryRow label="Category (color)">
            {EXPENSE_CATEGORIES.map((category) => <CategoryBadge key={category} category={category} tone="color" />)}
          </GalleryRow>
        </GallerySection>

        <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
          <Card>
            <Card.Header
              title="Card with actions"
              description="Header = title + optional actions"
              actions={<Button size="xs" variant="ghost">View all →</Button>}
            />
            <Card.Body>
              <StatGroup>
                <Stat size="hero" label="Total this month" value={<Amount value={2481.35} currency="EUR" size="hero" />} />
                <Stat size="sm" label="Transactions" value="42" />
                <Stat size="sm" label="Average" value={<Amount value={59.08} currency="EUR" />} />
              </StatGroup>
            </Card.Body>
          </Card>
          <Card variant="subtle">
            <Card.Header title="Subtle card" />
            <Card.Body>
              <Stack gap="3">
                <SectionHeader title="Section header" meta="Updated 2 minutes ago" actions={<Button size="xs">Action</Button>} />
                <GalleryRow label="Amount sizes">
                  <Amount value={1234.5} currency="EUR" size="lg" />
                  <Amount value={1234.5} currency="EUR" />
                  <Amount value={1234.5} currency="EUR" size="sm" />
                </GalleryRow>
                <GalleryRow label="tone=auto">
                  <Amount value="152.40" currency="USD" tone="auto" signed size="sm" />
                  <Amount value="-87.10" currency="USD" tone="auto" signed size="sm" />
                  <Text textStyle="bodySm">
                    <ValueWithChange value="1520.00" currency="USD" change="120.50" changeLabel="Gain" changeTone="positive" />
                  </Text>
                </GalleryRow>
              </Stack>
            </Card.Body>
          </Card>
        </SimpleGrid>

        <GallerySection title="Table" description="40px rows, sentence-case label headers, numeric columns via data-numeric.">
          <Box overflowX="auto" borderWidth="1px" borderColor="border" borderRadius="card">
            <Table.Root interactive>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Transaction</Table.ColumnHeader>
                  <Table.ColumnHeader>Date</Table.ColumnHeader>
                  <Table.ColumnHeader>Category</Table.ColumnHeader>
                  <Table.ColumnHeader data-numeric>Amount</Table.ColumnHeader>
                  <Table.ColumnHeader width="10"><span className="sr-only">Actions</span></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {[
                  ["Weekly groceries", "Oct 12, 2026", "groceries", 86.4],
                  ["Fuel", "Oct 10, 2026", "car", 61.2],
                  ["Rent", "Oct 1, 2026", "housing", 950],
                ].map(([description, date, category, amount]) => (
                  <Table.Row key={String(description)}>
                    <Table.Cell fontWeight="medium">{description}</Table.Cell>
                    <Table.Cell color="fg.muted">{date}</Table.Cell>
                    <Table.Cell><CategoryBadge category={category as "car"} /></Table.Cell>
                    <Table.Cell data-numeric><Amount value={Number(amount)} currency="EUR" size="sm" /></Table.Cell>
                    <Table.Cell>
                      <IconButton aria-label={`Delete ${description}`} size="xs" tone="danger"><Trash2 size={ICON.xs} /></IconButton>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
          <Box as="ul" p="0" m="0">
            <ListRow
              title="Weekly groceries"
              meta="Oct 12 · Groceries"
              trailing={<Amount value={86.4} currency="EUR" size="sm" />}
              actions={<IconButton aria-label="Delete Weekly groceries" size="xs" tone="danger"><Trash2 size={ICON.xs} /></IconButton>}
            />
            <ListRow title="Fuel" meta="Oct 10 · Car / Car Fuel" trailing={<Amount value={61.2} currency="EUR" size="sm" />} />
          </Box>
        </GallerySection>

        <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
          <GallerySection title="Feedback">
            <InlineAlert status="error">The expense could not be saved.</InlineAlert>
            <InlineAlert status="warning" title="Net worth incomplete">Two items need a current value.</InlineAlert>
            <InlineAlert status="success">Settings saved.</InlineAlert>
            <InlineAlert status="info">You are offline. Changes are paused.</InlineAlert>
          </GallerySection>
          <Card>
            <EmptyState
              icon={<Inbox />}
              title="No recorded expenses"
              description="Add your first expense to start building this month’s picture."
              action={<Button size="xs" variant="solid" colorPalette="brand">Add expense</Button>}
            />
          </Card>
        </SimpleGrid>

        <GallerySection title="Dialogs" description="AppDialog docks to the bottom on mobile; ConfirmDialog stays centred.">
          <GalleryRow label="open">
            <AppDialog
              title="Add expense"
              description="Saved to October 2026."
              trigger={<Button variant="solid" colorPalette="brand"><Plus size={ICON.sm} aria-hidden="true" /> Add expense</Button>}
              footer={<FormActions submitLabel="Save expense" closesDialog onSubmit={() => undefined} />}
            >
              <Stack gap="3">
                <FormField label="Description"><Input placeholder="e.g. Weekly groceries" /></FormField>
                <FormField label="Amount (EUR)"><Input type="number" placeholder="0.00" /></FormField>
                <FormField label="Notes" optional><Textarea rows={3} /></FormField>
              </Stack>
            </AppDialog>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              trigger={<Button colorPalette="danger">Delete…</Button>}
              title="Delete this expense?"
              description="Weekly groceries will be permanently removed from your ledger."
              confirmLabel="Delete expense"
              onConfirm={() => setConfirmOpen(false)}
            />
          </GalleryRow>
        </GallerySection>

        <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
          <GallerySection title="Type scale"><TypeScale /></GallerySection>
          <GallerySection title="Colour tokens"><TokenSwatches /></GallerySection>
        </SimpleGrid>
      </Stack>
    </Container>
  );
}

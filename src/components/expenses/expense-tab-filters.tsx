"use client";

import {
  Button,
  Field,
  Flex,
  Input,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/types";
import { EXPENSE_SUBTYPES, SUBTYPE_LABELS, type ExpenseSubtype } from "@/lib/expenses/categories";
import { expenseTabHref } from "@/lib/frontend/expense-tab-state";
import { DEFAULT_EXPENSE_TAB_FILTERS, expenseTabFiltersSchema, type ExpenseTabFilters } from "@/lib/expenses/tab-filters";

type Scope = "all" | "year" | "range";
type FilterDraft = {
  scope: Scope;
  year: string;
  startDate: string;
  endDate: string;
  subtype: ExpenseTabFilters["subtype"];
  category: ExpenseCategory | "all";
  search: string;
};

function draftFor(filters: ExpenseTabFilters): FilterDraft {
  return {
    scope: filters.scope,
    year: filters.scope === "year" ? String(filters.year) : "",
    startDate: filters.scope === "range" ? filters.startDate : "",
    endDate: filters.scope === "range" ? filters.endDate : "",
    subtype: filters.subtype,
    category: filters.category ?? "all",
    search: filters.search,
  };
}

export function ExpenseTabFiltersForm({
  tabId,
  filters,
}: {
  tabId: string;
  filters: ExpenseTabFilters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState(() => draftFor(filters));
  const [error, setError] = useState("");

  function change<K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const common = {
      subtype: draft.subtype,
      category: draft.category === "all" ? null : draft.category,
      search: draft.search,
    };
    const raw = draft.scope === "year"
      ? { ...common, scope: "year", year: /^\d{4}$/.test(draft.year) ? Number(draft.year) : Number.NaN }
      : draft.scope === "range"
        ? { ...common, scope: "range", startDate: draft.startDate, endDate: draft.endDate }
        : { ...common, scope: "all" };
    const parsed = expenseTabFiltersSchema.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the filter values and try again.");
      return;
    }
    setError("");
    const params = new URLSearchParams(searchParams.toString());
    router.push(expenseTabHref(params, tabId, parsed.data), { scroll: false });
  }

  function reset() {
    setError("");
    setDraft(draftFor(DEFAULT_EXPENSE_TAB_FILTERS));
    const params = new URLSearchParams(searchParams.toString());
    router.push(expenseTabHref(params, tabId, DEFAULT_EXPENSE_TAB_FILTERS), { scroll: false });
  }

  return (
    <form onSubmit={apply}>
      <Stack gap="3" p={{ base: "4", md: "5" }} borderBottomWidth="1px" borderColor="canvas">
        <Flex gap="3" wrap="wrap" align="end">
          <Field.Root w={{ base: "full", sm: "10rem" }}>
            <Field.Label>Date scope</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={draft.scope}
                onChange={(event) => change("scope", event.target.value as Scope)}
                borderRadius="xl"
                bg="white"
              >
                <option value="all">All time</option>
                <option value="year">Year</option>
                <option value="range">Date range</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>

          {draft.scope === "year" ? (
            <Field.Root w={{ base: "full", sm: "8rem" }}>
              <Field.Label>Year</Field.Label>
              <Input
                type="number"
                min="100"
                max="9999"
                step="1"
                value={draft.year}
                onChange={(event) => change("year", event.target.value)}
                borderRadius="xl"
              />
            </Field.Root>
          ) : null}
          {draft.scope === "range" ? (
            <Flex flex="1" minW={{ base: "full", sm: "18rem" }} gap="3" wrap="wrap">
              <Field.Root flex="1" minW="8rem">
                <Field.Label>From</Field.Label>
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => change("startDate", event.target.value)}
                  borderRadius="xl"
                />
              </Field.Root>
              <Field.Root flex="1" minW="8rem">
                <Field.Label>To</Field.Label>
                <Input
                  type="date"
                  value={draft.endDate}
                  onChange={(event) => change("endDate", event.target.value)}
                  borderRadius="xl"
                />
              </Field.Root>
            </Flex>
          ) : null}

          <Field.Root flex="1" minW={{ base: "full", sm: "12rem" }}>
            <Field.Label>Search</Field.Label>
            <Input
              value={draft.search}
              maxLength={200}
              onChange={(event) => change("search", event.target.value)}
              placeholder="Description, notes, or category"
              borderRadius="xl"
            />
          </Field.Root>

          <Field.Root w={{ base: "full", sm: "12rem" }}>
            <Field.Label>Category</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={draft.category}
                onChange={(event) => change("category", event.target.value as ExpenseCategory | "all")}
                borderRadius="xl"
                bg="white"
              >
                <option value="all">All categories</option>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>

          <Field.Root w={{ base: "full", sm: "12rem" }}>
            <Field.Label>Subtype</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={draft.subtype}
                onChange={(event) => change("subtype", event.target.value as ExpenseTabFilters["subtype"])}
                borderRadius="xl"
                bg="white"
              >
                <option value="all">All subtypes</option>
                <option value="none">No subtype</option>
                {EXPENSE_SUBTYPES.map((subtype: ExpenseSubtype) => (
                  <option key={subtype} value={subtype}>{SUBTYPE_LABELS[subtype]}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>

          <Flex gap="2" align="end">
            <Button type="submit" colorPalette="purple" borderRadius="xl">Apply filters</Button>
            <Button type="button" variant="outline" borderRadius="xl" onClick={reset}>Reset</Button>
          </Flex>
        </Flex>
        {error ? <Text role="alert" color="error" fontSize="sm">{error}</Text> : null}
      </Stack>
    </form>
  );
}

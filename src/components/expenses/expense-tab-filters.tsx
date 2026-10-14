"use client";

import { Button, Flex, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import { FormField } from "@/components/ui/form-field";
import { Toolbar } from "@/components/ui/toolbar";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  EXPENSE_SUBTYPES,
  SUBTYPE_LABELS,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
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
      <Stack gap="2" p="4" borderBottomWidth="1px" borderColor="border">
        <Flex gap="3" wrap="wrap" align="end">
          <FormField label="Date scope" w={{ base: "full", sm: "9rem" }}>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={draft.scope}
                onChange={(event) => change("scope", event.target.value as Scope)}
              >
                <option value="all">All time</option>
                <option value="year">Year</option>
                <option value="range">Date range</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>

          {draft.scope === "year" ? (
            <FormField label="Year" w={{ base: "full", sm: "7rem" }}>
              <Input
                type="number"
                min="100"
                max="9999"
                step="1"
                value={draft.year}
                onChange={(event) => change("year", event.target.value)}
              />
            </FormField>
          ) : null}
          {draft.scope === "range" ? (
            <Flex flex="1" minW={{ base: "full", sm: "17rem" }} gap="3" wrap="wrap">
              <FormField label="From" flex="1" minW="8rem">
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => change("startDate", event.target.value)}
                />
              </FormField>
              <FormField label="To" flex="1" minW="8rem">
                <Input
                  type="date"
                  value={draft.endDate}
                  onChange={(event) => change("endDate", event.target.value)}
                />
              </FormField>
            </Flex>
          ) : null}

          <FormField label="Search" flex="1" minW={{ base: "full", sm: "12rem" }}>
            <Input
              value={draft.search}
              maxLength={200}
              onChange={(event) => change("search", event.target.value)}
              placeholder="Description, notes, or category"
            />
          </FormField>

          <FormField label="Category" w={{ base: "full", sm: "11rem" }}>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={draft.category}
                onChange={(event) => change("category", event.target.value as ExpenseCategory | "all")}
              >
                <option value="all">All categories</option>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>

          <FormField label="Subtype" w={{ base: "full", sm: "11rem" }}>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={draft.subtype}
                onChange={(event) => change("subtype", event.target.value as ExpenseTabFilters["subtype"])}
              >
                <option value="all">All subtypes</option>
                <option value="none">No subtype</option>
                {EXPENSE_SUBTYPES.map((subtype: ExpenseSubtype) => (
                  <option key={subtype} value={subtype}>{SUBTYPE_LABELS[subtype]}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>

          <Toolbar gap="1">
            <Button type="submit" variant="solid" colorPalette="brand">Apply filters</Button>
            <Button type="button" variant="ghost" onClick={reset}>Reset</Button>
          </Toolbar>
        </Flex>
        {error ? <Text role="alert" textStyle="caption" color="fg.error">{error}</Text> : null}
      </Stack>
    </form>
  );
}

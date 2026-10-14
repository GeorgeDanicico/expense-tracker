"use client";

import { Button, Field, Flex, Input, NativeSelect } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toolbar } from "@/components/ui/toolbar";
import { getBucharestMonth, getBucharestToday } from "@/lib/calendar";
import type { AnalyticsPeriod, CustomGranularity } from "@/lib/expenses/types";

const PERIODS = [
  { value: "3m", label: "3M", ariaLabel: "Previous 3 completed months" },
  { value: "6m", label: "6M", ariaLabel: "Previous 6 completed months" },
  { value: "1y", label: "12M", ariaLabel: "Previous 12 completed months" },
  { value: "2y", label: "24M", ariaLabel: "Previous 24 completed months" },
  { value: "custom", label: "Custom" },
] as const;

export function StatsFilter({
  initialPeriod,
  initialGranularity,
  initialCustomDate,
}: {
  initialPeriod: AnalyticsPeriod;
  initialGranularity: CustomGranularity;
  initialCustomDate: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState(initialPeriod);
  const [granularity, setGranularity] = useState(initialGranularity);
  const [customDate, setCustomDate] = useState(initialCustomDate);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "history");
    params.set("period", period);

    if (period === "custom") {
      params.set("granularity", granularity);
      params.set("date", customDate);
    }

    startTransition(() => router.push(`/dashboard?${params.toString()}`));
  }

  function changeGranularity(value: CustomGranularity) {
    setGranularity(value);
    setCustomDate(
      value === "day"
        ? getBucharestToday()
        : getBucharestMonth(),
    );
  }

  return (
    <form onSubmit={submit}>
      <Toolbar aria-label="Analysis period">
        <SegmentedControl<AnalyticsPeriod>
          aria-label="Analysis period"
          name="analysis-period"
          size="xs"
          items={PERIODS}
          value={period}
          onValueChange={setPeriod}
        />
        {period === "custom" ? (
          <Flex gap="2" align="center" wrap="wrap">
            <NativeSelect.Root size="xs" width={{ base: "10.5rem", md: "8.5rem" }}>
              <NativeSelect.Field
                aria-label="Custom unit"
                value={granularity}
                onChange={(event) => changeGranularity(event.target.value as CustomGranularity)}
              >
                <option value="month">Specific month</option>
                <option value="day">Specific day</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
            <Field.Root width="9.5rem">
              <Field.Label srOnly>{granularity === "day" ? "Day" : "Month"}</Field.Label>
              <Input
                size="xs"
                type={granularity === "day" ? "date" : "month"}
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
                required
              />
            </Field.Root>
          </Flex>
        ) : null}
        <Button type="submit" size="xs" variant="solid" colorPalette="brand" loading={pending}>
          Apply
        </Button>
      </Toolbar>
    </form>
  );
}

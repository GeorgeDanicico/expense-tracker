"use client";

import { Button, Field, Flex, Input, NativeSelect, Stack } from "@chakra-ui/react";
import { SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import type { AnalyticsPeriod, CustomGranularity } from "@/lib/types";

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
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState(initialPeriod);
  const [granularity, setGranularity] = useState(initialGranularity);
  const [customDate, setCustomDate] = useState(initialCustomDate);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams({ period });

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
        ? new Date().toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 7),
    );
  }

  return (
    <form onSubmit={submit}>
      <Flex gap="3" align="end" wrap="wrap" width={{ base: "full", lg: "auto" }}>
        <Field.Root flex={{ base: "1", sm: "initial" }} minW={{ base: "10rem", sm: "12rem" }}>
          <Field.Label>Analysis period</Field.Label>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={period}
              onChange={(event) => setPeriod(event.target.value as AnalyticsPeriod)}
            >
              <option value="3m">Last 3 months</option>
              <option value="6m">Last 6 months</option>
              <option value="1y">Last year</option>
              <option value="2y">Last 2 years</option>
              <option value="custom">Custom</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>

        {period === "custom" ? (
          <Stack direction={{ base: "column", sm: "row" }} gap="3" align="end">
            <Field.Root minW="160px">
              <Field.Label>Custom unit</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={granularity}
                  onChange={(event) =>
                    changeGranularity(event.target.value as CustomGranularity)
                  }
                >
                  <option value="month">Specific month</option>
                  <option value="day">Specific day</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            <Field.Root minW="170px">
              <Field.Label>{granularity === "day" ? "Day" : "Month"}</Field.Label>
              <Input
                size="sm"
                type={granularity === "day" ? "date" : "month"}
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
                required
              />
            </Field.Root>
          </Stack>
        ) : null}

        <Button
          type="submit"
          size="sm"
          variant="outline"
          borderRadius="lg"
          borderColor="gray.300"
          loading={pending}
        >
          <SlidersHorizontal size={15} aria-hidden="true" /> Apply
        </Button>
      </Flex>
    </form>
  );
}

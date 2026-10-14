"use client";

import { Flex, SimpleGrid, Stack } from "@chakra-ui/react";
import { Landmark, WalletCards } from "lucide-react";
import { useMemo } from "react";
import useSWR from "swr";

import { AddNetWorthItemDialog } from "@/components/net-worth/add-net-worth-item-dialog";
import { NetWorthAttention } from "@/components/net-worth/net-worth-attention";
import { NetWorthGroup } from "@/components/net-worth/net-worth-group";
import { NetWorthSummary } from "@/components/net-worth/net-worth-summary";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { useAccount } from "@/hooks/use-account";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiFetcher } from "@/lib/api/client";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
import type { NetWorthEntry, NetWorthOverview } from "@/lib/net-worth/types";

function groupedEntries(entries: NetWorthEntry[]) {
  const groups = new Map<string, NetWorthEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.category);
    if (group) group.push(entry);
    else groups.set(entry.category, [entry]);
  }

  const categoryOrder = ["investments", "cash", "property", "jewelry", "debt"];
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftIndex = categoryOrder.indexOf(left);
      const rightIndex = categoryOrder.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([category, categoryEntries]) => ({
      category,
      entries: categoryEntries.toSorted((left, right) => left.name.localeCompare(right.name)),
    }));
}

export function NetWorthPanel() {
  useDocumentTitle("Net worth");
  const { data, error, isLoading, isValidating, mutate } = useSWR<NetWorthOverview>(NET_WORTH_API_KEY, apiFetcher);
  const { currency } = useAccount();
  const grouped = useMemo(() => groupedEntries(data?.entries ?? []), [data?.entries]);

  if (isLoading && !data) return <DataLoading label="Loading your net worth…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your net worth…" />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader title="Net worth" actions={<AddNetWorthItemDialog defaultCurrency={currency} onSuccess={() => undefined} />} />
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />

      <NetWorthAttention overview={data} />

      {data.totalsByCurrency.length ? (
        <SimpleGrid columns={{ base: 1, sm: 2, xl: 3 }} gap="4" alignItems="start">
          {data.totalsByCurrency.map((total) => <NetWorthSummary key={total.currency} total={total} />)}
        </SimpleGrid>
      ) : null}

      {!data.entries.length ? (
        <Card>
          <EmptyState
            icon={<Landmark />}
            title="Build your balance sheet"
            description="Add cash, property, jewelry, debts or a custom asset. Investment holdings will appear automatically when they have an active position."
          />
        </Card>
      ) : (
        <Stack gap="4">
          {grouped.map((group) => <NetWorthGroup key={group.category} {...group} />)}
        </Stack>
      )}

      {data.totalsByCurrency.length > 1 ? (
        <Flex align="center" gap="2" textStyle="caption">
          <WalletCards size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Values stay in native currencies; no FX conversion is applied.
        </Flex>
      ) : null}
    </Stack>
  );
}

"use client";

import { Flex, SimpleGrid, Stack } from "@chakra-ui/react";
import { Landmark, WalletCards } from "lucide-react";
import { useMemo } from "react";
import useSWR from "swr";

import { ViewingControls } from "@/components/family/viewing-picker";
import { WriteOnly } from "@/components/family/write-only";
import { AddNetWorthItemDialog } from "@/components/net-worth/add-net-worth-item-dialog";
import { NetWorthAttention } from "@/components/net-worth/net-worth-attention";
import { NetWorthGroup } from "@/components/net-worth/net-worth-group";
import { NetWorthSummary } from "@/components/net-worth/net-worth-summary";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { SectionHeader } from "@/components/ui/section-header";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useViewing } from "@/hooks/use-viewing";
import { apiFetcher } from "@/lib/api/client";
import { netWorthApiKey } from "@/lib/api/keys";
import type { FamilyNetWorthOverview, NetWorthEntry, NetWorthOverview } from "@/lib/net-worth/types";

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

function SingleNetWorthPanel() {
  useDocumentTitle("Net worth");
  const { member, currency, readOnly, name } = useViewing();
  const { data, error, isLoading, isValidating, mutate } = useSWR<NetWorthOverview>(netWorthApiKey(member), apiFetcher);
  const grouped = useMemo(() => groupedEntries(data?.entries ?? []), [data?.entries]);

  if (isLoading && !data) return <DataLoading label="Loading your net worth…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your net worth…" />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader title="Net worth" actions={
          <WriteOnly>
            <AddNetWorthItemDialog defaultCurrency={currency} onSuccess={() => undefined} />
          </WriteOnly>
        }
      />
      <ViewingControls noun="net worth" family />
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
            title={readOnly ? "Nothing here yet" : "Build your balance sheet"}
            description={
              readOnly
                ? `${name} hasn’t added anything to their balance sheet yet.`
                : "Add cash, property, jewelry, debts or a custom asset. Investment holdings will appear automatically when they have an active position."
            }
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

/** The family view: the members' totals added per currency, then each member's balance sheet, read-only. */
function FamilyNetWorthPanel() {
  useDocumentTitle("Net worth");
  const { data, error, isLoading, isValidating, mutate } = useSWR<FamilyNetWorthOverview>(netWorthApiKey("all"), apiFetcher);

  if (isLoading && !data) return <DataLoading label="Loading the family's net worth…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading the family's net worth…" />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader title="Net worth" />
      <ViewingControls noun="net worth" family />
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />

      <Stack gap="3" as="section" aria-labelledby="family-net-worth-total">
        <SectionHeader id="family-net-worth-total" title="Family total" meta="Everyone's figures added together in each currency." />
        {data.totalsByCurrency.length ? (
          <SimpleGrid columns={{ base: 1, sm: 2, xl: 3 }} gap="4" alignItems="start">
            {data.totalsByCurrency.map((total) => <NetWorthSummary key={total.currency} total={total} />)}
          </SimpleGrid>
        ) : (
          <Card>
            <EmptyState icon={<Landmark />} title="Nothing here yet" description="Nobody in the family has added anything to a balance sheet yet." />
          </Card>
        )}
      </Stack>

      {data.members.map((entry) => (
        <Stack key={entry.memberId} as="section" gap="3" aria-labelledby={`family-net-worth-${entry.memberId}`}>
          <SectionHeader id={`family-net-worth-${entry.memberId}`} title={entry.name} />
          <NetWorthAttention overview={entry.overview} />
          {entry.overview.totalsByCurrency.length ? (
            <SimpleGrid columns={{ base: 1, sm: 2, xl: 3 }} gap="4" alignItems="start">
              {entry.overview.totalsByCurrency.map((total) => <NetWorthSummary key={total.currency} total={total} />)}
            </SimpleGrid>
          ) : null}
          {entry.overview.entries.length ? (
            groupedEntries(entry.overview.entries).map((group) => <NetWorthGroup key={group.category} {...group} />)
          ) : (
            <Card>
              <EmptyState icon={<Landmark />} title="Nothing here yet" description={`${entry.name} hasn’t added anything to their balance sheet yet.`} />
            </Card>
          )}
        </Stack>
      ))}

      <Flex align="center" gap="2" textStyle="caption">
        <WalletCards size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Values stay in native currencies; no FX conversion is applied.
      </Flex>
    </Stack>
  );
}

export function NetWorthPanel() {
  const { family } = useViewing();
  return family ? <FamilyNetWorthPanel /> : <SingleNetWorthPanel />;
}

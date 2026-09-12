"use client";

import { Alert, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { Inbox, TriangleAlert, TrendingUp } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { BrokerSection } from "@/components/investments/broker-section";
import { DataError, DataLoading, DataUpdating } from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { apiFetcher } from "@/lib/api/client";
import { INVESTMENTS_API_KEY } from "@/lib/api/keys";
import { investmentAssetKey } from "@/lib/investments/identity";
import type { InvestmentOverviewAsset, InvestmentsOverview } from "@/lib/investments/types";
import { useDocumentTitle } from "@/hooks/use-document-title";

function EmptyInvestments() {
  return (
    <Surface p={{ base: "8", md: "12" }}>
      <Flex minH="17rem" align="center" justify="center" textAlign="center">
        <Stack align="center" gap="4">
          <Flex width="14" height="14" align="center" justify="center" borderRadius="2xl" color="purple.600" bg="purple.50">
            <Inbox size={25} aria-hidden="true" />
          </Flex>
          <Stack align="center" gap="1.5">
            <Heading as="h2" size="lg" letterSpacing="-0.025em">No investments yet</Heading>
            <Text maxW="28rem" color="gray.500" fontSize="sm">
              Your investment accounts will appear here once their first executed order is recorded.
            </Text>
          </Stack>
        </Stack>
      </Flex>
    </Surface>
  );
}

function CalculationIssues({ overview }: { overview: InvestmentsOverview }) {
  if (!overview.calculationIssues?.length) return null;

  return (
    <Alert.Root status="warning" borderRadius="2xl">
      <Alert.Indicator />
      <Stack gap="1">
        <Text fontWeight="750">Some investment history needs attention</Text>
        {overview.calculationIssues.map((issue) => (
          <Alert.Description key={`${issue.transactionId}-${issue.code}`}>
            {issue.instrument ? `${issue.instrument}: ` : ""}{issue.message}
          </Alert.Description>
        ))}
      </Stack>
    </Alert.Root>
  );
}

export function InvestmentsPanel() {
  useDocumentTitle("Investments");
  const { data, error, isLoading, isValidating, mutate } = useSWR<InvestmentsOverview>(INVESTMENTS_API_KEY, apiFetcher);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (isLoading && !data) return <DataLoading label="Loading your investments…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your investments…" />;

  function selectAsset(accountId: string, asset: InvestmentOverviewAsset) {
    const nextKey = investmentAssetKey(accountId, asset.instrument, asset.currency);
    setSelectedKey((current) => current === nextKey ? null : nextKey);
  }

  return (
    <Stack gap={{ base: "6", md: "7" }}>
      <Stack gap="1">
        <Flex align="center" gap="3">
          <Text color="purple.600" fontSize="sm" fontWeight="750">INVESTMENTS</Text>
          {isValidating ? <DataUpdating /> : null}
        </Flex>
        <Flex align={{ base: "flex-start", sm: "center" }} gap="3" wrap="wrap">
          <TrendingUp size={26} color="#7c3aed" aria-hidden="true" />
          <Heading as="h1" size={{ base: "2xl", md: "3xl" }} color="gray.900" letterSpacing="-0.045em">
            Investments, kept clear
          </Heading>
        </Flex>
        <Text color="gray.500">Track holdings by broker and native currency. Values marked “Mock price” are simulated development quotes.</Text>
      </Stack>

      <CalculationIssues overview={data} />

      {!data.brokers.length ? <EmptyInvestments /> : (
        <Stack gap={{ base: "5", md: "6" }}>
          {data.brokers.map((broker) => (
            <BrokerSection
              key={broker.accountId}
              broker={broker}
              selectedKey={selectedKey}
              onSelect={(asset) => selectAsset(broker.accountId, asset)}
              onClose={() => setSelectedKey(null)}
            />
          ))}
        </Stack>
      )}

      {data.brokers.length && !data.calculationIssues?.length ? (
        <Flex align="center" gap="2" color="gray.400" fontSize="xs">
          <TriangleAlert size={14} aria-hidden="true" />
          Values are shown separately by currency; no currencies are combined.
        </Flex>
      ) : null}
    </Stack>
  );
}

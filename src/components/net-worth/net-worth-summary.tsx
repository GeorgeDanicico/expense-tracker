import { Flex, Stack, Text } from "@chakra-ui/react";

import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import type { NetWorthTotal } from "@/lib/net-worth/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

/** Headline net worth for one currency, with assets/liabilities and completeness. */
export function NetWorthSummary({ total }: { total: NetWorthTotal }) {
  const complete = total.status === "complete";
  return (
    <Card>
      <Card.Body>
        <Stack gap="4">
          <Stack gap="1">
            <Flex align="center" gap="2">
              <Text textStyle="label" color="fg.muted">Net worth ({total.currency})</Text>
              <StatusBadge tone={complete ? "positive" : "warning"}>
                {complete ? "Complete" : "Incomplete"}
              </StatusBadge>
            </Flex>
            {total.netWorth === null ? (
              <Text textStyle="amountHero" color="fg.warning">Partial</Text>
            ) : (
              <Amount value={total.netWorth} currency={total.currency} size="hero" as="p" />
            )}
            {total.netWorth === null ? (
              <Text textStyle="caption" color="fg.warning">
                Partial known subtotal {formatInvestmentAmount(total.knownSubtotal, total.currency)}
              </Text>
            ) : null}
          </Stack>
          <Flex gap="8" wrap="wrap">
            <Stat size="sm" label="Assets" value={<Amount value={total.assets} currency={total.currency} />} />
            <Stat size="sm" label="Liabilities" value={<Amount value={total.liabilities} currency={total.currency} />} />
          </Flex>
          {total.missingValueCount > 0 ? (
            <Text textStyle="caption" color="fg.warning">
              {total.missingValueCount} value{total.missingValueCount === 1 ? "" : "s"} need attention before this total is complete.
            </Text>
          ) : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}

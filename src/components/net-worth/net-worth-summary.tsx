import { Flex, Stack, Text } from "@chakra-ui/react";

import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import type { NetWorthTotal } from "@/lib/net-worth/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

/** Headline net worth for one currency, with assets/liabilities and completeness. */
export function NetWorthSummary({ total }: { total: NetWorthTotal }) {
  return (
    <Card>
      <Card.Body>
        <Stack gap="4">
          <Stack gap="1">
            <Text textStyle="label" color="fg.muted">Net worth ({total.currency})</Text>
            {total.netWorth === null ? (
              <Text textStyle="amountHero" color="fg.warning">Incomplete</Text>
            ) : (
              <Amount value={total.netWorth} currency={total.currency} size="hero" as="p" />
            )}
            {total.netWorth === null ? (
              <Text textStyle="caption" color="fg.warning">
                Known so far {formatInvestmentAmount(total.knownSubtotal, total.currency)}
                {total.missingValueCount > 0 ? ` · ${total.missingValueCount} ${total.missingValueCount === 1 ? "value needs" : "values need"} attention` : ""}
              </Text>
            ) : null}
          </Stack>
          <Flex gap="8" wrap="wrap">
            <Stat size="sm" label="Assets" value={<Amount value={total.assets} currency={total.currency} />} />
            <Stat size="sm" label="Liabilities" value={<Amount value={total.liabilities} currency={total.currency} />} />
          </Flex>
        </Stack>
      </Card.Body>
    </Card>
  );
}

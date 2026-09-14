import { Text } from "@chakra-ui/react";

import { getInvestmentValuePresentation } from "@/lib/investments/presentation";

export function InvestmentValue({
  currentValue,
  unrealizedGain,
  currency,
}: {
  currentValue: string | null;
  unrealizedGain: string | null;
  currency: string;
}) {
  const presentation = getInvestmentValuePresentation(currentValue, unrealizedGain, currency);

  return (
    <>
      {presentation.value}
      {presentation.change ? (
        <Text as="span" ml="2" color={presentation.changeColor} fontSize="0.85em" fontWeight="750" whiteSpace="nowrap">
          {presentation.change}
        </Text>
      ) : null}
    </>
  );
}

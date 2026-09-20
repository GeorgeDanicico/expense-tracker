import { Text } from "@chakra-ui/react";

import { formatInvestmentAmount } from "@/lib/utils/currency";

export type ValueChangeTone = "positive" | "negative" | "neutral";

function changeColor(tone: ValueChangeTone) {
  if (tone === "positive") return "green.700";
  if (tone === "negative") return "red.700";
  return "gray.600";
}

function formatSignedAmount(amount: string, currency: string) {
  const formatted = formatInvestmentAmount(amount, currency);
  const numericAmount = Number(amount);
  return Number.isFinite(numericAmount) && numericAmount > 0 ? `+${formatted}` : formatted;
}

export function ValueWithChange({
  value,
  currency,
  change,
  changeLabel,
  changeTone = "neutral",
  unavailableLabel = "Value unavailable",
}: {
  value: string | null;
  currency: string;
  change: string | null;
  changeLabel: string | null;
  changeTone?: ValueChangeTone;
  unavailableLabel?: string;
}) {
  return (
    <>
      {value === null ? unavailableLabel : formatInvestmentAmount(value, currency)}
      {change !== null && changeLabel ? (
        <Text
          as="span"
          ml="2"
          color={changeColor(changeTone)}
          fontSize="0.85em"
          fontWeight="750"
          whiteSpace="normal"
        >
          {changeLabel} {formatSignedAmount(change, currency)}
        </Text>
      ) : null}
    </>
  );
}

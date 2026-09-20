import { ValueWithChange } from "@/components/ui/value-with-change";
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

  const changeTone = presentation.changeColor === "green.700"
    ? "positive"
    : presentation.changeColor === "red.700"
      ? "negative"
      : "neutral";

  return (
    <ValueWithChange
      value={currentValue}
      currency={currency}
      change={presentation.change && unrealizedGain !== null ? unrealizedGain : null}
      changeLabel={presentation.change ? presentation.changeLabel : null}
      changeTone={changeTone}
    />
  );
}

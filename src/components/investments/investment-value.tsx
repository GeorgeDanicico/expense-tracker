import { ValueWithChange, type ValueChangeTone } from "@/components/ui/value-with-change";
import { getInvestmentValuePresentation } from "@/lib/investments/presentation";

/** Maps the presentation helper's colour names onto value-change tones. */
function gainTone(color: string): ValueChangeTone {
  if (color === "green.700") return "positive";
  if (color === "red.700") return "negative";
  return "neutral";
}

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
    <ValueWithChange
      value={currentValue}
      currency={currency}
      change={presentation.change && unrealizedGain !== null ? unrealizedGain : null}
      changeLabel={presentation.change ? presentation.changeLabel : null}
      changeTone={gainTone(presentation.changeColor)}
    />
  );
}

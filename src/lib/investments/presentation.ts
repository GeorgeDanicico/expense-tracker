import { formatInvestmentAmount } from "@/lib/utils/currency";

export type InvestmentGainPresentation = {
  value: string;
  color: "green.700" | "red.700" | "gray.500" | "gray.700";
  label: "Gain" | "Loss" | "No change" | "No quote";
  isAvailable: boolean;
};

export type InvestmentValuePresentation = {
  value: string;
  change: string | null;
  changeColor: InvestmentGainPresentation["color"];
  changeLabel: InvestmentGainPresentation["label"];
};

export function getInvestmentGainPresentation(
  value: string | null,
  currency: string,
): InvestmentGainPresentation {
  if (value === null) {
    return { value: "Unavailable", color: "gray.500", label: "No quote", isAvailable: false };
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return { value: "Unavailable", color: "gray.500", label: "No quote", isAvailable: false };
  }

  if (numericValue > 0) {
    return {
      value: `+${formatInvestmentAmount(value, currency)}`,
      color: "green.700",
      label: "Gain",
      isAvailable: true,
    };
  }

  if (numericValue < 0) {
    return {
      value: formatInvestmentAmount(value, currency),
      color: "red.700",
      label: "Loss",
      isAvailable: true,
    };
  }

  return {
    value: formatInvestmentAmount(value, currency),
    color: "gray.700",
    label: "No change",
    isAvailable: true,
  };
}

export function getInvestmentValuePresentation(
  currentValue: string | null,
  unrealizedGain: string | null,
  currency: string,
): InvestmentValuePresentation {
  const gain = getInvestmentGainPresentation(unrealizedGain, currency);

  return {
    value: currentValue === null ? "Value unavailable" : formatInvestmentAmount(currentValue, currency),
    change: gain.isAvailable ? gain.value : null,
    changeColor: gain.color,
    changeLabel: gain.label,
  };
}

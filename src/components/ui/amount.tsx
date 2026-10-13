import { Text, type TextProps } from "@chakra-ui/react";

import { formatCurrency, formatInvestmentAmount } from "@/lib/utils/currency";

const TEXT_STYLE = {
  hero: "amountHero",
  lg: "amountLg",
  md: "amount",
  sm: "amountSm",
} as const;

export type AmountTone = "default" | "auto" | "positive" | "negative" | "muted";

function toneColor(tone: AmountTone, numeric: number) {
  if (tone === "auto") {
    if (numeric > 0) return "fg.success";
    if (numeric < 0) return "fg.error";
    return "fg.muted";
  }
  if (tone === "positive") return "fg.success";
  if (tone === "negative") return "fg.error";
  if (tone === "muted") return "fg.muted";
  return undefined;
}

/**
 * A formatted money amount with tabular numerals. Numbers use the ledger
 * format; strings are investment decimals (currency code display). `auto`
 * tone colours positive and negative values.
 */
export function Amount({
  value,
  currency,
  size = "md",
  tone = "default",
  signed = false,
  as = "span",
  textAlign,
}: {
  value: number | string | null;
  currency: string;
  size?: keyof typeof TEXT_STYLE;
  tone?: AmountTone;
  /** Prefix positive values with "+". */
  signed?: boolean;
  as?: "span" | "p" | "dd" | "div";
  textAlign?: TextProps["textAlign"];
}) {
  const numeric = value === null ? 0 : Number(value);
  const formatted =
    typeof value === "number"
      ? formatCurrency(value, currency)
      : formatInvestmentAmount(value, currency);
  return (
    <Text
      as={as}
      textStyle={TEXT_STYLE[size]}
      color={toneColor(tone, numeric)}
      textAlign={textAlign}
      overflowWrap="anywhere"
    >
      {signed && numeric > 0 ? `+${formatted}` : formatted}
    </Text>
  );
}

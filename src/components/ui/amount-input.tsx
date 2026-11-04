"use client";

import { chakra, Flex, Input, InputGroup, Text } from "@chakra-ui/react";
import { forwardRef, useMemo, useState, type ChangeEvent } from "react";

/** Up to nine whole digits and two decimals: what an amount field accepts while it is typed. */
const AMOUNT = /^\d{0,9}(\.\d{0,2})?$/;

/**
 * The amount as typed, or `previous` when the keystroke would make it invalid. A comma counts as
 * the decimal point (phones in many locales show one), spaces are dropped, and a third decimal or
 * a second point is refused, so the field never holds more than two decimals.
 */
export function sanitizeAmount(next: string, previous: string) {
  const amount = next.replace(/\s/g, "").replace(",", ".");
  return AMOUNT.test(amount) ? amount : previous;
}

/** The currency's symbol as amounts show it ("€", "£", "RON"). */
export function currencySymbol(currency: string) {
  const parts = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

type AmountInputProps = {
  /** The account's currency (an ISO code), shown next to the amount. */
  currency: string;
  /** The amount as text, controlled. Leave it out to let the field keep its own (forms with `name`). */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** `hero`: the quick-add amount (40 px, centred). `field`: an ordinary input with the currency in front. */
  variant?: "hero" | "field";
  name?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Amount first: the phone's decimal keypad (`inputMode="decimal"`), the currency shown, and at most
 * two decimals enforced as it is typed (audit B1's client half). A text input, not `type="number"`,
 * so a comma works and nothing else slips in.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { currency, value, defaultValue = "", onValueChange, variant = "field", placeholder = "0.00", "aria-label": ariaLabel, ...props },
  ref,
) {
  const [own, setOwn] = useState(defaultValue);
  const text = value ?? own;
  const symbol = useMemo(() => currencySymbol(currency), [currency]);
  const field = {
    ...props,
    type: "text",
    inputMode: "decimal" as const,
    autoComplete: "off",
    placeholder,
    value: text,
    // The hero has no visible label; a field gets its name from its `FormField` label.
    "aria-label": ariaLabel ?? (variant === "hero" ? `Amount in ${currency}` : undefined),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const next = sanitizeAmount(event.target.value, text);
      if (value === undefined) setOwn(next);
      onValueChange?.(next);
    },
  };

  if (variant === "field") {
    return (
      <InputGroup startElement={<Text as="span" color="fg.muted" aria-hidden="true">{symbol}</Text>}>
        <Input ref={ref} {...field} fontVariantNumeric="tabular-nums" />
      </InputGroup>
    );
  }
  return (
    <Flex align="baseline" justify="center" gap="1.5" pt="1">
      <Text as="span" textStyle="amountLg" color="fg.subtle" aria-hidden="true">
        {symbol}
      </Text>
      <chakra.input
        ref={ref}
        {...field}
        // As wide as what's typed, so the symbol stays next to the number.
        width={`${Math.max(4, text.length) + 0.5}ch`}
        bg="transparent"
        borderWidth="0"
        outline="none"
        textAlign="center"
        caretColor="fg.accent"
        fontVariantNumeric="tabular-nums"
        textStyle="amountInput"
      />
    </Flex>
  );
});

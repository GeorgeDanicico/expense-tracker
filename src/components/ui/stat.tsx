import { Flex, Stat as ChakraStat } from "@chakra-ui/react";
import type { ReactNode } from "react";

const SIZE = { hero: "lg", md: "md", sm: "sm" } as const;
const TONE = {
  default: undefined,
  positive: "fg.success",
  negative: "fg.error",
  warning: "fg.warning",
  muted: "fg.muted",
} as const;

/** Label + figure. One `hero` stat per screen; secondary metrics use `sm`. */
export function Stat({
  label,
  value,
  size = "md",
  helper,
  change,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  size?: keyof typeof SIZE;
  helper?: ReactNode;
  /** Optional delta rendered under the value (e.g. `<ValueWithChange>`). */
  change?: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <ChakraStat.Root size={SIZE[size]} flex="0 1 auto" minW={size === "hero" ? "10rem" : "6rem"}>
      <ChakraStat.Label>{label}</ChakraStat.Label>
      <ChakraStat.ValueText color={TONE[tone]}>
        {value}
      </ChakraStat.ValueText>
      {change ? <ChakraStat.HelpText>{change}</ChakraStat.HelpText> : null}
      {helper ? <ChakraStat.HelpText>{helper}</ChakraStat.HelpText> : null}
    </ChakraStat.Root>
  );
}

/** Lays out a hero stat followed by secondary stats, wrapping on narrow screens. */
export function StatGroup({ children }: { children: ReactNode }) {
  return (
    <Flex wrap="wrap" align="flex-end" columnGap={{ base: "6", md: "12" }} rowGap="3">
      {children}
    </Flex>
  );
}

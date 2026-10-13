import { Flex, type FlexProps } from "@chakra-ui/react";

/** A row of filters/controls with consistent gap and wrapping. */
export function Toolbar({
  children,
  justify = "flex-start",
  align = "center",
  gap = "2",
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  justify?: FlexProps["justify"];
  align?: FlexProps["align"];
  gap?: "1" | "2" | "3";
  "aria-label"?: string;
}) {
  return (
    <Flex
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      align={align}
      justify={justify}
      gap={gap}
      wrap="wrap"
      minW="0"
    >
      {children}
    </Flex>
  );
}

"use client";

import { Card as ChakraCard, Flex, type CardRootProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

import type { WithoutStyleOverrides } from "@/components/ui/types";

type CardProps = WithoutStyleOverrides<CardRootProps> & {
  variant?: "outline" | "subtle";
  size?: "sm" | "md";
};

function CardRoot({ variant = "outline", size = "md", ...props }: CardProps) {
  return <ChakraCard.Root variant={variant} size={size} {...props} />;
}

function CardHeader({
  title,
  description,
  actions,
  as = "h2",
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3" | "h4";
  id?: string;
}) {
  return (
    <ChakraCard.Header>
      <Flex align="flex-start" justify="space-between" gap="3" minW="0">
        <Flex direction="column" gap="0.5" minW="0">
          <ChakraCard.Title as={as} id={id}>
            {title}
          </ChakraCard.Title>
          {description ? (
            <ChakraCard.Description>{description}</ChakraCard.Description>
          ) : null}
        </Flex>
        {actions ? (
          <Flex align="center" gap="1" flexShrink="0" mt="-1" me="-1.5">
            {actions}
          </Flex>
        ) : null}
      </Flex>
    </ChakraCard.Header>
  );
}

function CardBody(props: WithoutStyleOverrides<ChakraCard.BodyProps>) {
  return <ChakraCard.Body {...props} />;
}

function CardFooter(props: WithoutStyleOverrides<ChakraCard.FooterProps>) {
  return <ChakraCard.Footer {...props} />;
}

/**
 * A bordered surface. `Card.Header` holds the title and optional actions;
 * `variant="subtle"` drops the border for nested or secondary blocks.
 */
export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});

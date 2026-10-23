"use client";

import { Link as ChakraLink, Stack, Switch } from "@chakra-ui/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { McpAccess, McpBlockReason } from "@/lib/mcp/token-repository";

export const MCP_SWITCH_LABEL = "Let AI assistants use your account";

/** Why a kid can't turn the switch on, and where it gets fixed. */
export const MCP_BLOCK_MESSAGES: Record<McpBlockReason, ReactNode> = {
  not_permitted: "A parent can turn on AI assistants for you in Manage family.",
  email_required: (
    <>
      Add and confirm an email address on the{" "}
      <ChakraLink asChild color="fg.accent">
        <Link href="/settings">Account tab</Link>
      </ChakraLink>{" "}
      to use AI assistants.
    </>
  ),
};

/**
 * What the switch can do for this caller. A blocked kid can't turn it on, but can always turn it off
 * (a parent may have turned the permission off while it was on).
 */
export function mcpSwitchState(enabled: boolean, access: Pick<McpAccess, "blockReason">) {
  return {
    disabled: !enabled && access.blockReason !== null,
    reason: access.blockReason,
  };
}

/** The per-user switch, with the reason a kid can't turn it on. */
export function McpSwitchCard({
  enabled,
  access,
  pending = false,
  error,
  onChange,
}: {
  enabled: boolean;
  access: Pick<McpAccess, "blockReason">;
  pending?: boolean;
  error?: string;
  onChange: (enabled: boolean) => void;
}) {
  const { disabled, reason } = mcpSwitchState(enabled, access);

  return (
    <Card>
      <Card.Header
        title="AI assistants"
        description="Apps like Claude Code can read and change your expenses, tabs, net worth and investments, as you, within your permissions."
      />
      <Card.Body>
        <Stack gap="3">
          <Switch.Root
            checked={enabled}
            disabled={disabled || pending}
            onCheckedChange={(details) => onChange(details.checked)}
            colorPalette="brand"
            display="flex"
            justifyContent="space-between"
            gap="4"
            width="full"
          >
            <Switch.Label textStyle="bodySm" fontWeight="medium">
              {MCP_SWITCH_LABEL}
            </Switch.Label>
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
          {reason ? (
            <InlineAlert status={enabled ? "warning" : "neutral"}>
              {MCP_BLOCK_MESSAGES[reason]}
              {enabled ? " Until then, every app is refused." : null}
            </InlineAlert>
          ) : null}
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}

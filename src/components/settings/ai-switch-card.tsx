"use client";

import { List, Stack, Switch, Text } from "@chakra-ui/react";

import { Card } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { AiSettingsResponse } from "@/lib/api/keys";
import { policyFor } from "@/lib/ai/provider-policy";

export const AI_SWITCH_LABEL = "Read statements with AI";

/** Why a kid can't turn the switch on, and where it gets fixed. */
export const AI_BLOCK_MESSAGE = "A parent can turn on AI features for you in Manage family.";

/**
 * What the switch can do for this caller. A blocked kid can't turn it on; the switch is already off
 * for them (the access rule reads a kid without the permission as off), so it is simply disabled.
 */
export function aiSwitchState({ enabled, blockReason }: Pick<AiSettingsResponse, "enabled" | "blockReason">) {
  return { disabled: !enabled && blockReason !== null, reason: blockReason };
}

/** The per-user "Read statements with AI" switch, with what is and isn't sent and the provider's data policy. */
export function AiSwitchCard({
  settings,
  pending = false,
  error,
  onChange,
}: {
  settings: AiSettingsResponse;
  pending?: boolean;
  error?: string;
  onChange: (enabled: boolean) => void;
}) {
  const { disabled, reason } = aiSwitchState(settings);
  const provider = policyFor(settings.provider);

  return (
    <Card>
      <Card.Header
        title="AI features"
        description="When you import a bank statement, AI can read its rows and suggest a category for each. It's off until you turn it on."
      />
      <Card.Body>
        <Stack gap="4">
          <Switch.Root
            checked={settings.enabled}
            disabled={disabled || pending}
            onCheckedChange={(details) => onChange(details.checked)}
            colorPalette="brand"
            display="flex"
            justifyContent="space-between"
            gap="4"
            width="full"
          >
            <Switch.Label textStyle="bodySm" fontWeight="medium">
              {AI_SWITCH_LABEL}
            </Switch.Label>
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
          {reason ? <InlineAlert status="neutral">{AI_BLOCK_MESSAGE}</InlineAlert> : null}
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}

          <Stack gap="2" aria-label="What happens to your statement">
            <Text textStyle="label">What happens to your statement</Text>
            <List.Root gap="1.5" ps="4" textStyle="bodySm" color="fg.muted">
              <List.Item>
                <strong>Sent:</strong> the text of the statement, with account and card numbers hidden, and the
                instructions for reading it.
              </List.Item>
              <List.Item>
                <strong>Not sent:</strong> the file itself, your name or email, and your other expenses.
              </List.Item>
              <List.Item>
                A statement can still print your name and address in its header. If it does, that text is sent too.
              </List.Item>
              <List.Item>
                {provider ? (
                  <>
                    <strong>Who receives it:</strong> {provider.name}. {provider.policy}
                  </>
                ) : (
                  <>
                    <strong>Who receives it:</strong> no AI provider is set up on this server, so nothing is sent.
                  </>
                )}
              </List.Item>
              <List.Item>
                Your family shares a monthly limit on AI use. When it&apos;s used up, imports go back to the
                built-in readers until the next month.
              </List.Item>
            </List.Root>
          </Stack>
        </Stack>
      </Card.Body>
    </Card>
  );
}

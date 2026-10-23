"use client";

import { Flex, Input, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";

import { CopyButton } from "@/components/family/create-invite-dialog";
import { CommandBlock, claudeMcpAddCommand } from "@/components/settings/mcp-command";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { CreatedMcpToken } from "@/lib/api/keys";

export const CLOSE_BEFORE_COPY_WARNING = "You won't see this token again. Close anyway?";

export type SecretDialogState = { copied: boolean; confirmingClose: boolean };
export type SecretDialogEvent = "copied" | "close" | "keep_open" | "close_anyway";
export const INITIAL_SECRET_DIALOG_STATE: SecretDialogState = { copied: false, confirmingClose: false };

/**
 * The show-once dialog's rules: closing after copying (the token or the command) closes; closing
 * before copying asks first. `"closed"` means the dialog closes and the secret is dropped.
 */
export function nextSecretDialogState(state: SecretDialogState, event: SecretDialogEvent): SecretDialogState | "closed" {
  switch (event) {
    case "copied":
      return { copied: true, confirmingClose: false };
    case "close":
      return state.copied ? "closed" : { ...state, confirmingClose: true };
    case "keep_open":
      return { ...state, confirmingClose: false };
    case "close_anyway":
      return "closed";
  }
}

/** The token, its Copy button and the filled-in Claude Code command; the close warning once asked. */
export function McpTokenSecretContent({
  created,
  origin,
  confirmingClose,
  onCopied,
}: {
  created: CreatedMcpToken;
  origin: string;
  confirmingClose: boolean;
  onCopied?: () => void;
}) {
  return (
    <Stack gap="4">
      <InlineAlert status="warning">Copy it now. Once you close this, it can&apos;t be shown again.</InlineAlert>
      <FormField label="Your token">
        <Flex align="center" gap="2" width="full">
          <Input
            value={created.secret}
            readOnly
            fontFamily="mono"
            autoComplete="off"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyButton text={created.secret} label="Copy token" onCopied={onCopied} />
        </Flex>
      </FormField>
      <Stack gap="1.5">
        <Text textStyle="label">Add it to Claude Code</Text>
        <CommandBlock
          command={claudeMcpAddCommand(origin, created.secret)}
          copyLabel="Copy the Claude Code command"
          onCopied={onCopied}
        />
      </Stack>
      {confirmingClose ? <InlineAlert status="warning" title={CLOSE_BEFORE_COPY_WARNING} /> : null}
    </Stack>
  );
}

/**
 * Shows a new or regenerated token once. The secret lives only in the caller's React state and this
 * dialog: never the SWR cache, storage or the URL. `onClose` must drop it.
 */
export function McpTokenSecretDialog({
  created,
  origin,
  onClose,
}: {
  created: CreatedMcpToken;
  origin: string;
  onClose: () => void;
}) {
  const [state, setState] = useState(INITIAL_SECRET_DIALOG_STATE);

  function send(event: SecretDialogEvent) {
    const next = nextSecretDialogState(state, event);
    if (next === "closed") onClose();
    else setState(next);
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open) send("close");
      }}
      title="Copy your token"
      description={`“${created.token.name}” is ready. Put it in the machine's config.`}
      footer={
        state.confirmingClose ? (
          <FormActions
            submitLabel="Close anyway"
            tone="danger"
            cancelLabel="Keep it open"
            onCancel={() => send("keep_open")}
            onSubmit={() => send("close_anyway")}
          />
        ) : (
          <FormActions submitLabel="Done" onSubmit={() => send("close")} />
        )
      }
    >
      <McpTokenSecretContent
        created={created}
        origin={origin}
        confirmingClose={state.confirmingClose}
        onCopied={() => send("copied")}
      />
    </AppDialog>
  );
}

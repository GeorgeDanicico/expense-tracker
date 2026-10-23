"use client";

import { Box, Button, Flex, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";

import { McpOffNote } from "@/components/settings/mcp-connected-apps";
import { McpTokenSecretDialog } from "@/components/settings/mcp-token-secret-dialog";
import { AppDialog } from "@/components/ui/app-dialog";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useApiForm } from "@/hooks/use-api-form";
import { createMcpToken, regenerateMcpToken, revokeMcpToken } from "@/hooks/use-mcp-settings";
import { MCP_SETTINGS_API_KEY, type CreatedMcpToken } from "@/lib/api/keys";
import { formatDateTime } from "@/lib/calendar";
import {
  DEFAULT_MCP_TOKEN_EXPIRY,
  MCP_TOKEN_EXPIRIES,
  MCP_TOKEN_EXPIRY_LABELS,
  type McpTokenExpiry,
} from "@/lib/mcp/token-expiry";
import type { McpToken } from "@/lib/mcp/token-repository";

export const NEVER_EXPIRES_WARNING =
  "We don't recommend tokens that never expire. This token would stay valid until you revoke it, so if it ever leaks, it keeps working. Pick an expiry unless this machine really needs a permanent token.";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Within this many days, an expiry gets the warning tone. */
const EXPIRY_WARNING_DAYS = 7;

/** A token's expiry as the list shows it, and the tone of its badge. */
export function tokenExpiryStatus(expiresAt: string | null, now: number): { label: string; tone: StatusTone } {
  if (expiresAt === null) return { label: "Never expires", tone: "warning" };
  const remaining = Date.parse(expiresAt) - now;
  if (remaining <= 0) return { label: "Expired", tone: "negative" };
  const days = Math.ceil(remaining / DAY_MS);
  return {
    label: `Expires in ${days} ${days === 1 ? "day" : "days"}`,
    tone: days <= EXPIRY_WARNING_DAYS ? "warning" : "neutral",
  };
}

/** `sl_mcp_Ab3xQ9…`: the stored prefix, marked as the start of a longer token. */
export function tokenDisplayPrefix(token: Pick<McpToken, "prefix">) {
  return `${token.prefix}…`;
}

function formatDay(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
}

/** The token list's two caption lines: prefix and created, then last used ("Never" when unused). */
export function tokenMeta(token: McpToken) {
  const lastUsed = token.lastUsedAt ? formatDateTime(token.lastUsedAt, "en-GB") : "Never";
  return {
    meta: `${tokenDisplayPrefix(token)} · Created ${formatDay(token.createdAt)}`,
    detail: `Last used: ${lastUsed}`,
  };
}

/** The Expires select, with the never-expires warning right under it. */
export function ExpirySelect({
  value,
  onChange,
  name = "expiry",
}: {
  value: McpTokenExpiry;
  onChange: (expiry: McpTokenExpiry) => void;
  name?: string;
}) {
  return (
    <Stack gap="2" flex="1">
      <FormField label="Expires">
        <NativeSelect.Root>
          <NativeSelect.Field name={name} value={value} onChange={(event) => onChange(event.target.value as McpTokenExpiry)}>
            {MCP_TOKEN_EXPIRIES.map((expiry) => (
              <option key={expiry} value={expiry}>
                {MCP_TOKEN_EXPIRY_LABELS[expiry]}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </FormField>
      {value === "never" ? <InlineAlert status="warning">{NEVER_EXPIRES_WARNING}</InlineAlert> : null}
    </Stack>
  );
}

/** A name and an expiry; creating answers the secret, which goes straight to the show-once dialog. */
export function CreateMcpTokenForm({
  onCreated,
  defaultExpiry = DEFAULT_MCP_TOKEN_EXPIRY,
}: {
  onCreated: (created: CreatedMcpToken) => void;
  defaultExpiry?: McpTokenExpiry;
}) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<McpTokenExpiry>(defaultExpiry);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async () => {
      const created = await createMcpToken({ name, expiry });
      onCreated(created);
      setName("");
      setExpiry(DEFAULT_MCP_TOKEN_EXPIRY);
      await mutate(MCP_SETTINGS_API_KEY);
    }, { fallback: "Unable to create the token. Please try again." });
  }

  return (
    <form onSubmit={create} aria-label="New personal token">
      <Stack gap="3">
        {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        <FormRow>
          <FormField label="Name" error={form.fieldError("name")} flex="1" alignSelf="flex-start">
            <Input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Home server"
              maxLength={40}
              autoComplete="off"
              required
            />
          </FormField>
          <ExpirySelect value={expiry} onChange={setExpiry} />
        </FormRow>
        <Flex justify="flex-end">
          <Button type="submit" variant="solid" colorPalette="brand" loading={form.pending}>
            <KeyRound size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Create token
          </Button>
        </Flex>
      </Stack>
    </form>
  );
}

/** Asks for the new expiry (3 months by default), then regenerates and hands the secret on. */
function RegenerateDialog({
  token,
  onOpenChange,
  onCreated,
}: {
  token: McpToken;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedMcpToken) => void;
}) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [expiry, setExpiry] = useState<McpTokenExpiry>(DEFAULT_MCP_TOKEN_EXPIRY);
  const formId = `regenerate-${token.id}`;

  function regenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async () => {
      const created = await regenerateMcpToken(token.id, expiry);
      onOpenChange(false);
      onCreated(created);
      await mutate(MCP_SETTINGS_API_KEY);
    }, { fallback: "Unable to regenerate the token. Please try again." });
  }

  return (
    <AppDialog
      open
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      size="sm"
      title={`Regenerate “${token.name}”?`}
      description="The current token stops working right away. You'll copy the new one next."
      footer={<FormActions submitLabel="Regenerate" form={formId} closesDialog pending={form.pending} />}
    >
      <form id={formId} onSubmit={regenerate}>
        <Stack gap="3">
          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          <ExpirySelect value={expiry} onChange={setExpiry} name="regenerate-expiry" />
        </Stack>
      </form>
    </AppDialog>
  );
}

function McpTokenRow({
  token,
  now,
  onCreated,
}: {
  token: McpToken;
  now: number;
  onCreated: (created: CreatedMcpToken) => void;
}) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [dialog, setDialog] = useState<"regenerate" | "revoke" | null>(null);
  const expiry = tokenExpiryStatus(token.expiresAt, now);
  const { meta, detail } = tokenMeta(token);

  function revoke() {
    void form.submit(async () => {
      await revokeMcpToken(token.id);
      await mutate(MCP_SETTINGS_API_KEY);
      setDialog(null);
    }, { fallback: "Unable to revoke the token. Please try again." });
  }

  return (
    <Flex
      as="li"
      listStyleType="none"
      direction={{ base: "column", sm: "row" }}
      align={{ base: "stretch", sm: "center" }}
      gap={{ base: "2", sm: "3" }}
      py="2.5"
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: "0" }}
    >
      <Stack gap="0.5" flex="1" minW="0">
        <Flex align="center" gap="2" minW="0">
          <Text textStyle="bodySm" fontWeight="medium" truncate>
            {token.name}
          </Text>
          <Box flexShrink="0">
            <StatusBadge tone={expiry.tone}>{expiry.label}</StatusBadge>
          </Box>
        </Flex>
        <Text textStyle="caption" truncate>
          {meta}
        </Text>
        <Text textStyle="caption" truncate>
          {detail}
        </Text>
      </Stack>
      <Flex gap="1" flexShrink="0">
        <Button size="xs" variant="outline" onClick={() => setDialog("regenerate")} aria-label={`Regenerate ${token.name}`}>
          Regenerate
        </Button>
        <Button size="xs" variant="outline" onClick={() => setDialog("revoke")} aria-label={`Revoke ${token.name}`}>
          Revoke
        </Button>
      </Flex>
      {dialog === "regenerate" ? (
        <RegenerateDialog token={token} onOpenChange={(open) => setDialog(open ? "regenerate" : null)} onCreated={onCreated} />
      ) : null}
      {dialog === "revoke" ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!form.pending) setDialog(next ? "revoke" : null);
          }}
          title={`Revoke “${token.name}”?`}
          description="Anything using it is refused from its next request. This can't be undone."
          confirmLabel="Revoke"
          onConfirm={revoke}
          pending={form.pending}
          error={form.error}
        />
      ) : null}
    </Flex>
  );
}

/**
 * Personal access tokens, for adults: create one, copy it once, then regenerate or revoke it. A new
 * secret is kept only in this component's state until its dialog closes.
 */
export function McpTokensCard({
  tokens,
  enabled,
  origin,
  now,
  defaultExpiry,
}: {
  tokens: readonly McpToken[];
  enabled: boolean;
  origin: string;
  /** The clock for expiries, in milliseconds. */
  now: number;
  /** The create form's starting expiry (the UI gallery shows "never"). */
  defaultExpiry?: McpTokenExpiry;
}) {
  const [created, setCreated] = useState<CreatedMcpToken | null>(null);

  return (
    <Card>
      <Card.Header
        title="Personal access tokens"
        description="For machines without a browser, like a server or Claude Code over Remote Control. Use Connected apps wherever you can."
      />
      <Card.Body>
        <Stack gap="4">
          {!enabled ? (
            <McpOffNote>AI assistants are off, so these tokens are refused until you turn it back on.</McpOffNote>
          ) : null}
          <CreateMcpTokenForm onCreated={setCreated} defaultExpiry={defaultExpiry} />
          {tokens.length === 0 ? (
            <EmptyState size="sm" titleAs="p" title="No personal tokens" description="Create one above for a machine that can't sign in." />
          ) : (
            <Box as="ul" m="0" p="0" borderTopWidth="1px" borderColor="border">
              {tokens.map((token) => (
                <McpTokenRow key={token.id} token={token} now={now} onCreated={setCreated} />
              ))}
            </Box>
          )}
        </Stack>
      </Card.Body>
      {created ? <McpTokenSecretDialog created={created} origin={origin} onClose={() => setCreated(null)} /> : null}
    </Card>
  );
}

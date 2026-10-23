"use client";

import { Box, Button, Stack, Text } from "@chakra-ui/react";
import { Plug } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { CommandBlock, claudeMcpAddCommand } from "@/components/settings/mcp-command";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ListRow } from "@/components/ui/list-row";
import { disconnectMcpApp } from "@/hooks/use-mcp-settings";
import { useApiForm } from "@/hooks/use-api-form";
import { MCP_SETTINGS_API_KEY } from "@/lib/api/keys";
import type { ConnectedApp } from "@/lib/auth/oauth-consent";
import { formatDateTime } from "@/lib/calendar";

/** Shown on both lists while the switch is off. */
export function McpOffNote({ children }: { children: string }) {
  return <InlineAlert status="neutral">{children}</InlineAlert>;
}

function ConnectedAppRow({ app }: { app: ConnectedApp }) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [confirming, setConfirming] = useState(false);
  const connected = `Connected ${formatDateTime(app.connectedAt, "en-GB")}`;

  function disconnect() {
    void form.submit(async () => {
      await disconnectMcpApp(app.clientId);
      await mutate(MCP_SETTINGS_API_KEY);
      setConfirming(false);
    }, { fallback: "Unable to disconnect the app. Please try again." });
  }

  return (
    <ListRow
      title={app.name}
      meta={connected}
      detail={app.uri ?? undefined}
      actions={
        <>
          <Button size="xs" variant="outline" onClick={() => setConfirming(true)} aria-label={`Disconnect ${app.name}, ${connected}`}>
            Disconnect
          </Button>
          {confirming ? (
            <ConfirmDialog
              open
              onOpenChange={(next) => {
                if (!form.pending) setConfirming(next);
              }}
              title={`Disconnect ${app.name}?`}
              description={`${connected}. It's refused from its next request; to use it again, connect it again. Other connections with the same name stay.`}
              confirmLabel="Disconnect"
              onConfirm={disconnect}
              pending={form.pending}
              error={form.error}
            />
          ) : null}
        </>
      }
    />
  );
}

/**
 * The apps the caller allowed through the sign-in page. The same app can be listed more than once
 * (Claude Code registers again each time its authentication is cleared); the connected date tells
 * them apart, and each disconnects on its own.
 */
export function McpConnectedAppsCard({
  apps,
  enabled,
  origin,
}: {
  apps: readonly ConnectedApp[];
  enabled: boolean;
  origin: string;
}) {
  return (
    <Card>
      <Card.Header title="Connected apps" description="Apps you allowed through the sign-in page." />
      <Card.Body>
        <Stack gap="3">
          {!enabled ? (
            <McpOffNote>AI assistants are off, so these apps are refused until you turn it back on.</McpOffNote>
          ) : null}
          {apps.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Plug />}
              title="No connected apps"
              description="To connect Claude Code, run this in a terminal, then sign in and click Allow."
              action={
                <Box width="full" maxW="lg">
                  <CommandBlock command={claudeMcpAddCommand(origin)} copyLabel="Copy the Claude Code command" />
                </Box>
              }
            />
          ) : (
            <>
              <Box as="ul" m="0" p="0">
                {apps.map((app) => (
                  <ConnectedAppRow key={app.clientId} app={app} />
                ))}
              </Box>
              <Text textStyle="caption">
                An app can appear more than once, once per connection. Disconnect the ones you no longer use.
              </Text>
            </>
          )}
        </Stack>
      </Card.Body>
    </Card>
  );
}

"use client";

import { Stack } from "@chakra-ui/react";
import { useState } from "react";

import { useOrigin } from "@/components/settings/mcp-command";
import { McpConnectedAppsCard } from "@/components/settings/mcp-connected-apps";
import { McpSwitchCard } from "@/components/settings/mcp-switch-card";
import { McpTokensCard } from "@/components/settings/mcp-tokens";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useApiForm } from "@/hooks/use-api-form";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { setMcpEnabled, useMcpSettings } from "@/hooks/use-mcp-settings";

export default function AiAssistantsSettingsPage() {
  useDocumentTitle("AI assistants");
  const { settings, error, mutate } = useMcpSettings();
  const switchForm = useApiForm();
  const origin = useOrigin();
  // The clock for token expiries, read once per visit.
  const [now] = useState(() => Date.now());

  function toggle(enabled: boolean) {
    void switchForm.submit(async () => {
      const updated = await setMcpEnabled(enabled);
      await mutate(updated, { revalidate: false });
    }, { fallback: "Unable to save your AI assistant setting. Please try again." });
  }

  if (error && !settings) return <DataError retry={() => void mutate()} />;
  if (!settings) return <DataLoading label="Loading your AI assistant settings…" />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <McpSwitchCard
        enabled={settings.enabled}
        access={settings.access}
        pending={switchForm.pending}
        error={switchForm.error}
        onChange={toggle}
      />
      <McpConnectedAppsCard apps={settings.apps} enabled={settings.enabled} origin={origin} />
      {settings.access.personalTokens && settings.tokens ? (
        <McpTokensCard tokens={settings.tokens} enabled={settings.enabled} origin={origin} now={now} />
      ) : null}
    </Stack>
  );
}

"use client";

import { Stack } from "@chakra-ui/react";

import { AiSwitchCard } from "@/components/settings/ai-switch-card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useApiForm } from "@/hooks/use-api-form";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { setAiEnabled, useAiSettings } from "@/hooks/use-ai-settings";

export default function AiFeaturesSettingsPage() {
  useDocumentTitle("AI features");
  const { settings, error, mutate } = useAiSettings();
  const switchForm = useApiForm();

  function toggle(enabled: boolean) {
    void switchForm.submit(async () => {
      const updated = await setAiEnabled(enabled);
      await mutate(updated, { revalidate: false });
    }, { fallback: "Unable to save your AI setting. Please try again." });
  }

  if (error && !settings) return <DataError retry={() => void mutate()} />;
  if (!settings) return <DataLoading label="Loading your AI settings…" />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <AiSwitchCard settings={settings} pending={switchForm.pending} error={switchForm.error} onChange={toggle} />
    </Stack>
  );
}

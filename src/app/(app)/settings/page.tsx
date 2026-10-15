"use client";

import { Button, NativeSelect, Stack } from "@chakra-ui/react";
import { Save } from "lucide-react";
import { FormEvent, useState } from "react";

import { DataError, DataLoading } from "@/components/ui/data-state";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useAccount } from "@/hooks/use-account";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/api/client";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import type { AccountData } from "@/lib/account/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const { account: data, error, isLoading, mutate } = useAccount();
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function saveCurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");

    try {
      const updated = await apiRequest<AccountData>(ACCOUNT_API_KEY, {
        method: "PATCH",
        body: JSON.stringify({ currency: selectedCurrency ?? data?.currency }),
      });
      await mutate(updated, { revalidate: false });
      setStatus("saved");
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "The currency could not be saved.");
    }
  }

  if (isLoading && !data) return <DataLoading label="Loading your settings…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your settings…" />;
  const currency = selectedCurrency ?? data.currency;

  return (
    <Stack maxW="780px" gap={{ base: "4", md: "5" }}>
      <PageHeader title="Settings" />

      {status === "saved" ? <InlineAlert status="success">Your account currency was updated.</InlineAlert> : null}
      {status === "error" ? <InlineAlert status="error">{message}</InlineAlert> : null}

      <Card>
        <Card.Header
          title="Display currency"
          description="Used across your dashboard, expense list, and exports."
        />
        <form onSubmit={saveCurrency}>
          <Card.Body>
            <Stack gap="3">
              <FormField
                label="Account currency"
                orientation={{ base: "vertical", md: "horizontal" }}
                css={{ "--field-label-width": "sizes.40" }}
              >
                <NativeSelect.Root maxW={{ md: "20rem" }}>
                  <NativeSelect.Field
                    name="currency"
                    value={currency}
                    onChange={(event) => {
                      setSelectedCurrency(event.target.value);
                      setStatus("idle");
                    }}
                  >
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label} ({option.code})
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
              <InlineAlert status="neutral">
                Changing currency updates the label only. Existing amounts are not converted.
              </InlineAlert>
            </Stack>
          </Card.Body>
          <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
            <Button type="submit" variant="solid" colorPalette="brand" loading={status === "saving"}>
              <Save size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Save changes
            </Button>
          </Card.Footer>
        </form>
      </Card>
    </Stack>
  );
}

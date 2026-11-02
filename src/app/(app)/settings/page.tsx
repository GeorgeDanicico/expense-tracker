"use client";

import { Button, Input, NativeSelect, Stack } from "@chakra-ui/react";
import { Mail, Save } from "lucide-react";
import { FormEvent, useState } from "react";

import { AvatarCard } from "@/components/settings/avatar-card";
import { SignOutEverywhereCard } from "@/components/settings/sign-out-everywhere-card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useAccount } from "@/hooks/use-account";
import { useApiForm } from "@/hooks/use-api-form";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { changeEmail } from "@/lib/api/account-requests";
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
  const emailForm = useApiForm();
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

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

  function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (emailForm.pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "");
    const currentPassword = String(formData.get("currentPassword") ?? "");

    void emailForm.submit(async () => {
      await changeEmail({ email, currentPassword });
      setEmailSentTo(email.trim());
      form.reset();
    }, { fallback: "Unable to save your email. Please try again." });
  }

  if (isLoading && !data) return <DataLoading label="Loading your settings…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your settings…" />;
  const currency = selectedCurrency ?? data.currency;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      {status === "saved" ? <InlineAlert status="success">Your account currency was updated.</InlineAlert> : null}
      {status === "error" ? <InlineAlert status="error">{message}</InlineAlert> : null}

      <AvatarCard signInName={data.signInName} avatarUrl={data.avatarUrl} />

      {data.email === null ? (
        <Card>
          <Card.Header
            title="Add an email address"
            description="Use it to recover your account. You can keep signing in with your username. Enter your current password to confirm it's you."
          />
          <form onSubmit={saveEmail}>
            <Card.Body>
              <Stack gap="3">
                {emailSentTo ? (
                  <InlineAlert status="success">
                    We sent a link to {emailSentTo}. Open it to finish adding your email.
                  </InlineAlert>
                ) : null}
                {emailForm.error ? <InlineAlert status="error">{emailForm.error}</InlineAlert> : null}
                <FormField
                  label="Email address"
                  error={emailForm.fieldError("email")}
                  orientation={{ base: "vertical", md: "horizontal" }}
                  css={{ "--field-label-width": "sizes.40" }}
                >
                  <Input
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    maxW={{ md: "20rem" }}
                    required
                  />
                </FormField>
                <FormField
                  label="Current password"
                  error={emailForm.fieldError("currentPassword")}
                  orientation={{ base: "vertical", md: "horizontal" }}
                  css={{ "--field-label-width": "sizes.40" }}
                >
                  <Input
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    maxW={{ md: "20rem" }}
                    maxLength={128}
                    required
                  />
                </FormField>
              </Stack>
            </Card.Body>
            <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
              <Button type="submit" variant="solid" colorPalette="brand" loading={emailForm.pending}>
                <Mail size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Send link
              </Button>
            </Card.Footer>
          </form>
        </Card>
      ) : null}

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

      <SignOutEverywhereCard />
    </Stack>
  );
}

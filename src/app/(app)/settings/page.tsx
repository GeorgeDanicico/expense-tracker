"use client";

import { Button, Input, Stack } from "@chakra-ui/react";
import { Mail } from "lucide-react";
import { FormEvent, useState } from "react";

import { AvatarCard } from "@/components/settings/avatar-card";
import { CurrencyCard } from "@/components/settings/currency-card";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { DownloadDataCard } from "@/components/settings/download-data-card";
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
import { ACCOUNT_API_KEY } from "@/lib/api/keys";

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const { account: data, error, isLoading, mutate } = useAccount();
  const emailForm = useApiForm();
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

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

  if (isLoading && !data) return <DataLoading label="Loading your settings…" slowKey={ACCOUNT_API_KEY} />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your settings…" slowKey={ACCOUNT_API_KEY} />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
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

      <CurrencyCard currency={data.currency} onSaved={(updated) => mutate(updated, { revalidate: false })} />

      <SignOutEverywhereCard />

      <DownloadDataCard />

      <DeleteAccountCard membership={data.membership} />
    </Stack>
  );
}

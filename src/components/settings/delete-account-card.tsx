"use client";

import { Button, Input, List, Stack, Text } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";

import { AppDialog } from "@/components/ui/app-dialog";
import { Card } from "@/components/ui/card";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { forgetThisDeviceBeforeSignOut } from "@/hooks/use-notification-settings";
import { DELETE_ACCOUNT_PHRASE } from "@/lib/account/data-repository";
import type { AccountMembership } from "@/lib/account/types";
import { deleteAccount } from "@/lib/api/account-requests";
import { afterSignOut } from "@/lib/api/invalidate";
import { currentSubscription } from "@/lib/notifications/browser";

/**
 * Why an account in a family can't be deleted from here yet, in the words the server uses for the
 * same refusal; null when it can.
 */
export function deletionBlockedReason(membership: AccountMembership | null): string | null {
  if (!membership) return null;
  if (membership.isCreator) {
    return `You created ${membership.familyName}, so your account can't be deleted yet. Delete the family first in Family settings, then come back here.`;
  }
  if (membership.role === "kid") {
    return `You're in ${membership.familyName}. Ask a parent: they can delete your account from Manage family.`;
  }
  return `You're in ${membership.familyName}. Ask the family's creator to remove you, then come back here.`;
}

/**
 * Settings → Account: deletes the account and everything in it (`DELETE /api/account`). Hard to do by
 * accident: the button only opens a dialog, which asks for the current password and for the phrase
 * "delete my account" typed out, and its delete button stays off until the phrase matches. An
 * account in a family sees why it can't be deleted yet instead of the button.
 */
export function DeleteAccountCard({ membership }: { membership: AccountMembership | null }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const blocked = deletionBlockedReason(membership);
  const formId = "delete-account";
  const phraseMatches = typed.trim().toLowerCase() === DELETE_ACCOUNT_PHRASE;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phraseMatches) return;
    const currentPassword = String(new FormData(event.currentTarget).get("currentPassword") ?? "");

    void form.submit(async () => {
      await deleteAccount({ currentPassword, confirm: typed.trim() });
      // The server already deleted this browser's push subscription with the account; stop it here too.
      await forgetThisDeviceBeforeSignOut({ current: currentSubscription, deleteOnServer: async () => undefined });
      await afterSignOut(mutate);
      router.replace("/login");
    }, { fallback: "Unable to delete your account. Please try again." });
  }

  return (
    <Card>
      <Card.Header
        title="Delete my account"
        description="Deletes your account and everything in it for good. This can't be undone. Download your data first if you want to keep a copy."
      />
      {blocked ? (
        <Card.Body>
          <InlineAlert status="neutral">{blocked}</InlineAlert>
        </Card.Body>
      ) : null}
      <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
        <Button
          variant="outline"
          colorPalette="danger"
          disabled={blocked !== null}
          onClick={() => {
            form.reset();
            setTyped("");
            setOpen(true);
          }}
        >
          <Trash2 size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Delete my account
        </Button>
      </Card.Footer>
      {open ? (
        <AppDialog
          open
          onOpenChange={setOpen}
          pending={form.pending}
          title="Delete your account?"
          description="This can't be undone."
          footer={
            <FormActions
              submitLabel="Delete my account"
              form={formId}
              closesDialog
              tone="danger"
              pending={form.pending}
              disabled={!phraseMatches}
            />
          }
        >
          <form id={formId} onSubmit={submit}>
            <Stack gap="3">
              {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
              <Text textStyle="bodySm">These are deleted for good:</Text>
              <List.Root ps="5" textStyle="bodySm" color="fg.muted">
                <List.Item>Your expenses, expense tabs, investments and net worth</List.Item>
                <List.Item>Your reminders, notifications and statement imports</List.Item>
                <List.Item>Your profile picture, access tokens and connected AI apps</List.Item>
                <List.Item>Your sign-in details: you&apos;ll be signed out on every device</List.Item>
              </List.Root>
              <FormField label="Current password" error={form.fieldError("currentPassword")}>
                <Input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  disabled={form.pending}
                />
              </FormField>
              <FormField label={`Type ${DELETE_ACCOUNT_PHRASE} to confirm`} error={form.fieldError("confirm")}>
                <Input
                  name="confirm"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={form.pending}
                />
              </FormField>
            </Stack>
          </form>
        </AppDialog>
      ) : null}
    </Card>
  );
}

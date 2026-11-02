"use client";

import { Input, List, Stack, Text } from "@chakra-ui/react";
import { useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterFamilyChanged } from "@/lib/api/invalidate";
import { familyMemberAccountApiUrl, type FamilyResponse } from "@/lib/api/keys";
import type { FamilyMemberView } from "@/lib/family/views";

/**
 * A parent deletes a kid account they made for the family, with everything in it. Asks for the
 * parent's own password and the kid's name typed out; the delete button stays off until the name
 * matches. Calls `DELETE /api/family/members/[id]/account`. The server refuses a kid who joined with
 * their own account, and says so here.
 */
export function DeleteKidAccountDialog({
  member,
  open,
  onOpenChange,
}: {
  member: FamilyMemberView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [typed, setTyped] = useState("");
  const name = member.displayName ?? member.username ?? "";
  const formId = `delete-kid-account-${member.memberId}`;
  const nameMatches = name !== "" && typed.trim().toLowerCase() === name.toLowerCase();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameMatches) return;
    const currentPassword = String(new FormData(event.currentTarget).get("currentPassword") ?? "");

    void form.submit(async () => {
      const response = await apiRequest<FamilyResponse>(familyMemberAccountApiUrl(member.memberId), {
        method: "DELETE",
        body: JSON.stringify({ currentPassword, confirmName: typed.trim() }),
      });
      await afterFamilyChanged(mutate, response);
      onOpenChange(false);
    }, { fallback: "Unable to delete the account. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={`Delete ${name}'s account?`}
      description="This can't be undone."
      footer={
        <FormActions
          submitLabel="Delete account"
          form={formId}
          closesDialog
          tone="danger"
          pending={form.pending}
          disabled={!nameMatches}
        />
      }
    >
      <form id={formId} onSubmit={submit}>
        <Stack gap="3">
          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          <Text textStyle="bodySm">
            {name}&apos;s account is deleted for good, with everything in it:
          </Text>
          <List.Root ps="5" textStyle="bodySm" color="fg.muted">
            <List.Item>Their expenses, investments, net worth and reminders</List.Item>
            <List.Item>Their sign-in: they&apos;re signed out on every device</List.Item>
            <List.Item>Family to-dos and events stay, without them</List.Item>
          </List.Root>
          <FormField label="Your password" error={form.fieldError("currentPassword")}>
            <Input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              disabled={form.pending}
            />
          </FormField>
          <FormField label={`Type ${name} to confirm`} error={form.fieldError("confirmName")}>
            <Input
              name="confirmName"
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
  );
}

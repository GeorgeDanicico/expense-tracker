"use client";

import { Input, Stack } from "@chakra-ui/react";
import { useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";

import { KidSignInDetails } from "@/components/family/kid-sign-in-details";
import { PermissionsEditor } from "@/components/family/permissions-editor";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterFamilyChanged } from "@/lib/api/invalidate";
import { FAMILY_KIDS_API_URL, type FamilyResponse } from "@/lib/api/keys";
import { DEFAULT_KID_PERMISSIONS, type Permissions } from "@/lib/permissions";

/** Create a kid account: name, username, temporary password and permissions. Calls `POST /api/family/kids`. */
export function CreateKidDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_KID_PERMISSIONS);
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null);
  const formId = "create-kid";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get("displayName") ?? "").trim();
    const username = String(data.get("username") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");

    void form.submit(async () => {
      const updated = await apiRequest<FamilyResponse>(FAMILY_KIDS_API_URL, {
        method: "POST",
        body: JSON.stringify({ displayName, username, password, permissions }),
      });
      setCreated({ name: displayName, username, password });
      await afterFamilyChanged(mutate, updated);
    }, { fallback: "Unable to create the account. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={created ? "Kid added" : "Add a kid"}
      description={created ? undefined : "Create an account for a kid. They sign in with a username, so no email is needed."}
      footer={
        created ? (
          <FormActions submitLabel="Done" onSubmit={() => onOpenChange(false)} />
        ) : (
          <FormActions submitLabel="Add kid" form={formId} closesDialog pending={form.pending} />
        )
      }
    >
      {created ? (
        <KidSignInDetails name={created.name} username={created.username} password={created.password} />
      ) : (
        <form id={formId} onSubmit={submit}>
          <Stack gap="4">
            {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
            <FormField label="Name" error={form.fieldError("displayName")}>
              <Input name="displayName" autoComplete="off" maxLength={40} required disabled={form.pending} />
            </FormField>
            <FormField
              label="Username"
              error={form.fieldError("username")}
              hint="3–30 lowercase letters, numbers, dots, underscores or hyphens."
            >
              <Input
                name="username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                required
                disabled={form.pending}
              />
            </FormField>
            <FormField
              label="Temporary password"
              error={form.fieldError("password")}
              hint="At least 8 characters. They'll choose their own the first time they sign in."
            >
              <Input
                name="password"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                minLength={8}
                maxLength={128}
                required
                disabled={form.pending}
              />
            </FormField>
            <PermissionsEditor value={permissions} onChange={setPermissions} disabled={form.pending} />
          </Stack>
        </form>
      )}
    </AppDialog>
  );
}

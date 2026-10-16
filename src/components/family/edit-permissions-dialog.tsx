"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";

import { PermissionsEditor } from "@/components/family/permissions-editor";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterFamilyChanged } from "@/lib/api/invalidate";
import { familyMemberPermissionsApiUrl, type FamilyResponse } from "@/lib/api/keys";
import type { FamilyMember } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS, type Permissions } from "@/lib/permissions";

/** Edit one kid's permissions. Saving calls `PATCH /api/family/members/[id]/permissions`. */
export function EditPermissionsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: FamilyMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [permissions, setPermissions] = useState<Permissions>(member.permissions ?? DEFAULT_KID_PERMISSIONS);
  const name = member.displayName ?? member.username ?? "this kid";
  const formId = `edit-permissions-${member.memberId}`;

  function save() {
    void form.submit(async () => {
      const updated = await apiRequest<FamilyResponse>(familyMemberPermissionsApiUrl(member.memberId), {
        method: "PATCH",
        body: JSON.stringify({ permissions }),
      });
      await afterFamilyChanged(mutate, updated);
      onOpenChange(false);
    }, { fallback: "Unable to save the permissions. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={`Permissions for ${name}`}
      description="Changes apply the next time they open the app."
      footer={<FormActions submitLabel="Save permissions" form={formId} closesDialog pending={form.pending} />}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        <PermissionsEditor value={permissions} onChange={setPermissions} disabled={form.pending} />
      </form>
    </AppDialog>
  );
}

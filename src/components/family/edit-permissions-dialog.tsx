"use client";

import { useState } from "react";

import { useFamilyWrites } from "@/components/family/use-family-writes";
import { PermissionsEditor } from "@/components/family/permissions-editor";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import type { FamilyMemberView } from "@/lib/family/views";
import { DEFAULT_KID_PERMISSIONS, type Permissions } from "@/lib/permissions";

/** Edit one kid's permissions. Saving calls `PATCH /api/family/members/[id]/permissions`. */
export function EditPermissionsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: FamilyMemberView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const writes = useFamilyWrites();
  const form = useApiForm();
  const [permissions, setPermissions] = useState<Permissions>(member.permissions ?? DEFAULT_KID_PERMISSIONS);
  const name = member.displayName ?? member.username ?? "this kid";
  const formId = `edit-permissions-${member.memberId}`;

  function save() {
    void form.submit(async () => {
      await writes.setPermissions(member.memberId, permissions);
      onOpenChange(false);
    }, { fallback: "Unable to save the permissions. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={form.pending}
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

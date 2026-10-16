"use client";

import { useSWRConfig } from "swr";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterMemberRemoved } from "@/lib/api/invalidate";
import { familyMemberApiUrl } from "@/lib/api/keys";
import type { FamilyMember } from "@/lib/family/repository";

/** Ask the creator to confirm removing a member. Calls `DELETE /api/family/members/[id]`. */
export function RemoveMemberDialog({
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
  const name = member.displayName ?? member.username ?? "this member";

  function remove() {
    void form.submit(async () => {
      await apiRequest<void>(familyMemberApiUrl(member.memberId), { method: "DELETE" });
      await afterMemberRemoved(mutate);
      onOpenChange(false);
    }, { fallback: "Unable to remove the member. Please try again." });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={`Remove ${name} from the family?`}
      description={`${name} keeps their account and their own data.`}
      confirmLabel="Remove"
      onConfirm={remove}
      pending={form.pending}
      error={form.error}
    />
  );
}

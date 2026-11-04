"use client";


import { useFamilyWrites } from "@/components/family/use-family-writes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApiForm } from "@/hooks/use-api-form";
import type { FamilyMemberView } from "@/lib/family/views";

/** Ask the creator to confirm removing a member. Calls `DELETE /api/family/members/[id]`. */
export function RemoveMemberDialog({
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
  const name = member.displayName ?? member.username ?? "this member";

  function remove() {
    void form.submit(async () => {
      await writes.removeMember(member.memberId);
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

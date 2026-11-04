"use client";

import { Box, Button } from "@chakra-ui/react";
import { KeyRound, Palette, ShieldCheck, Trash2, UserRoundX } from "lucide-react";
import { useState } from "react";

import { CreateKidDialog } from "@/components/family/create-kid-dialog";
import { DeleteKidAccountDialog } from "@/components/family/delete-kid-account-dialog";
import { EditColorDialog } from "@/components/family/edit-color-dialog";
import { EditPermissionsDialog } from "@/components/family/edit-permissions-dialog";
import { RemoveMemberDialog } from "@/components/family/remove-member-dialog";
import { ResetPasswordDialog } from "@/components/family/reset-password-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
import { RowActions, useRowActions, type RowAction } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { lastActiveLabel } from "@/lib/family/last-active-label";
import { memberColorTokens } from "@/lib/family/member-colors";
import type { FamilyMemberView, FamilyView } from "@/lib/family/views";

type Dialog = "colour" | "permissions" | "password" | "remove" | "delete";

function ManagedMemberRow({
  member,
  members,
  canRemove,
  color,
}: {
  member: FamilyMemberView;
  members: readonly FamilyMemberView[];
  canRemove: boolean;
  color: string | undefined;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { rowProps, menu } = useRowActions();
  const name = member.displayName ?? member.username ?? "Unnamed";
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const actions: RowAction[] = [
    { label: "Colour", icon: Palette, onSelect: () => setDialog("colour") },
    ...(member.role === "kid"
      ? [
          { label: "Permissions", icon: ShieldCheck, onSelect: () => setDialog("permissions") },
          { label: "Reset password", icon: KeyRound, onSelect: () => setDialog("password") },
          { label: "Delete account", icon: Trash2, onSelect: () => setDialog("delete"), tone: "danger" as const },
        ]
      : []),
    ...(canRemove && !member.isCreator
      ? [{ label: "Remove from family", icon: UserRoundX, onSelect: () => setDialog("remove"), tone: "danger" as const }]
      : []),
  ];

  return (
    <ListRow
      {...rowProps}
      leading={<Avatar size="md" name={name} src={member.avatarUrl} color={color} />}
      title={
        <Box as="span" display="inline-flex" alignItems="center" gap="2">
          {name}
          {member.isCreator ? <StatusBadge tone="brand">Creator</StatusBadge> : null}
        </Box>
      }
      meta={[member.role === "parent" ? "Parent" : "Kid", member.displayName && member.username ? `@${member.username}` : null, lastActiveLabel(member.lastActiveAt)]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <>
          <RowActions label={name} actions={actions} {...menu} />
          {dialog === "colour" ? <EditColorDialog member={member} members={members} open onOpenChange={close} /> : null}
          {dialog === "permissions" ? <EditPermissionsDialog member={member} open onOpenChange={close} /> : null}
          {dialog === "password" ? <ResetPasswordDialog member={member} open onOpenChange={close} /> : null}
          {dialog === "remove" ? <RemoveMemberDialog member={member} open onOpenChange={close} /> : null}
          {dialog === "delete" ? <DeleteKidAccountDialog member={member} open onOpenChange={close} /> : null}
        </>
      }
    />
  );
}

/** The members for parents, one row each (role, last active), whose actions are Colour, and for a kid Permissions, Reset password and Delete account, and Remove for the creator. */
export function ManageMembers({ data, isCreator = false }: { data: FamilyView; isCreator?: boolean }) {
  const [adding, setAdding] = useState(false);
  const colors = memberColorTokens(data.members);

  return (
    <Card>
      <Card.Header
        title="Members"
        description={`Everyone in ${data.family.name}.`}
        actions={
          <Button size="sm" variant="solid" colorPalette="brand" onClick={() => setAdding(true)}>
            Add a kid
          </Button>
        }
      />
      {adding ? <CreateKidDialog open onOpenChange={setAdding} /> : null}
      <Card.Body>
        <Box as="ul" m="0" p="0" mx="-2">
          {data.members.map((member) => (
            <ManagedMemberRow
              key={member.memberId}
              member={member}
              members={data.members}
              canRemove={isCreator}
              color={colors.get(member.memberId.toLowerCase())}
            />
          ))}
        </Box>
      </Card.Body>
    </Card>
  );
}

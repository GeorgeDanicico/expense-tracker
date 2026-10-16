"use client";

import { Box, Button, Flex, Table, Text } from "@chakra-ui/react";
import { useState } from "react";

import { CreateKidDialog } from "@/components/family/create-kid-dialog";
import { EditPermissionsDialog } from "@/components/family/edit-permissions-dialog";
import { RemoveMemberDialog } from "@/components/family/remove-member-dialog";
import { ResetPasswordDialog } from "@/components/family/reset-password-dialog";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { lastActiveLabel } from "@/lib/family/last-active-label";
import type { FamilyData, FamilyMember } from "@/lib/family/repository";

function memberName(member: FamilyMember) {
  return member.displayName ?? member.username ?? "Unnamed";
}

function roleLabel(member: FamilyMember) {
  return member.role === "parent" ? "Parent" : "Kid";
}

function MemberRow({ member, canRemove }: { member: FamilyMember; canRemove: boolean }) {
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const name = memberName(member);

  return (
    <Table.Row>
      <Table.Cell ps="4">
        <Flex align="center" gap="2" minW="0">
          <Box minW="0">
            <Text as="span" textStyle="bodySm" fontWeight="medium" display="block" truncate>
              {name}
            </Text>
            <Text as="span" textStyle="caption" display="block" truncate>
              <Text as="span" display={{ base: "inline", md: "none" }}>
                {roleLabel(member)}
                {member.displayName && member.username ? " · " : ""}
              </Text>
              {member.displayName && member.username ? `@${member.username}` : null}
            </Text>
          </Box>
          {member.isCreator ? <StatusBadge tone="brand">Creator</StatusBadge> : null}
        </Flex>
      </Table.Cell>
      <Table.Cell color="fg.muted" display={{ base: "none", md: "table-cell" }}>
        {roleLabel(member)}
      </Table.Cell>
      <Table.Cell color="fg.muted" whiteSpace="nowrap">
        {lastActiveLabel(member.lastActiveAt)}
      </Table.Cell>
      <Table.Cell pe="3">
        <Flex direction={{ base: "column", md: "row" }} align="stretch" justify="flex-end" gap="1.5">
          {member.role === "kid" ? (
            <>
              <Button size="xs" variant="outline" onClick={() => setEditing(true)} aria-label={`Edit permissions for ${name}`}>
                Edit permissions
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => setResetting(true)}
                aria-label={`Reset password for ${name}`}
              >
                Reset password
              </Button>
            </>
          ) : null}
          {canRemove && !member.isCreator ? (
            <Button
              size="xs"
              variant="outline"
              colorPalette="danger"
              onClick={() => setRemoving(true)}
              aria-label={`Remove ${name} from the family`}
            >
              Remove
            </Button>
          ) : null}
        </Flex>
        {editing ? <EditPermissionsDialog member={member} open onOpenChange={setEditing} /> : null}
        {resetting ? <ResetPasswordDialog member={member} open onOpenChange={setResetting} /> : null}
        {removing ? <RemoveMemberDialog member={member} open onOpenChange={setRemoving} /> : null}
      </Table.Cell>
    </Table.Row>
  );
}

/** The members table for parents: role, last activity, kid accounts, permission and password buttons for each kid, and Remove for the creator. */
export function ManageMembers({ data, isCreator = false }: { data: FamilyData; isCreator?: boolean }) {
  const [adding, setAdding] = useState(false);

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
      <Box overflowX="auto">
        <Table.Root>
          <Table.Caption className="sr-only">Family members</Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader ps="4">Name</Table.ColumnHeader>
              <Table.ColumnHeader display={{ base: "none", md: "table-cell" }}>Role</Table.ColumnHeader>
              <Table.ColumnHeader>Last active</Table.ColumnHeader>
              <Table.ColumnHeader pe="3">
                <span className="sr-only">Actions</span>
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.members.map((member) => (
              <MemberRow key={member.memberId} member={member} canRemove={isCreator} />
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Card>
  );
}

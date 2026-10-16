"use client";

import { Box, Button, Flex, Table, Text } from "@chakra-ui/react";
import { useState } from "react";

import { EditPermissionsDialog } from "@/components/family/edit-permissions-dialog";
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

function MemberRow({ member }: { member: FamilyMember }) {
  const [editing, setEditing] = useState(false);
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
      <Table.Cell pe="3" textAlign="end">
        {member.role === "kid" ? (
          <>
            <Button size="xs" variant="outline" onClick={() => setEditing(true)} aria-label={`Edit permissions for ${name}`}>
              Edit permissions
            </Button>
            {editing ? <EditPermissionsDialog member={member} open onOpenChange={setEditing} /> : null}
          </>
        ) : null}
      </Table.Cell>
    </Table.Row>
  );
}

/** The members table for parents: role, last activity, and a permissions button for each kid. */
export function ManageMembers({ data }: { data: FamilyData }) {
  return (
    <Card>
      <Card.Header title="Members" description={`Everyone in ${data.family.name}.`} />
      <Box overflowX="auto">
        <Table.Root>
          <Table.Caption className="sr-only">Family members</Table.Caption>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader ps="4">Name</Table.ColumnHeader>
              <Table.ColumnHeader display={{ base: "none", md: "table-cell" }}>Role</Table.ColumnHeader>
              <Table.ColumnHeader>Last active</Table.ColumnHeader>
              <Table.ColumnHeader width="10" pe="3">
                <span className="sr-only">Actions</span>
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.members.map((member) => (
              <MemberRow key={member.memberId} member={member} />
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Card>
  );
}

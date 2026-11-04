import { Flex, Stack, Text } from "@chakra-ui/react";

import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInstantDate } from "@/lib/calendar";
import { memberColorTokens } from "@/lib/family/member-colors";
import type { FamilyMemberView, FamilyView } from "@/lib/family/views";

/** "Joined 12 Oct 2026" (the day on the app's clock), or an empty string when the date can't be read. */
export function joinedLabel(joinedAt: string): string {
  return Number.isNaN(new Date(joinedAt).getTime()) ? "" : `Joined ${formatInstantDate(joinedAt)}`;
}

function MemberRow({ member, color }: { member: FamilyMemberView; color: string | undefined }) {
  const name = member.displayName ?? member.username ?? "Unnamed";
  const meta = [member.displayName && member.username ? `@${member.username}` : null, joinedLabel(member.joinedAt)]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListRow
      leading={<Avatar size="md" name={name} src={member.avatarUrl} color={color} />}
      title={
        <Flex as="span" align="center" gap="2" minW="0">
          <Text as="span" truncate>
            {name}
          </Text>
          {member.isCreator ? <StatusBadge tone="brand">Creator</StatusBadge> : null}
        </Flex>
      }
      meta={meta}
    />
  );
}

function MemberGroup({ title, members, colors }: { title: string; members: FamilyMemberView[]; colors: Map<string, string> }) {
  if (members.length === 0) return null;
  return (
    <Card>
      <Card.Header title={title} />
      <Card.Body>
        <Stack as="ul" gap="0" m="0" p="0">
          {members.map((member) => (
            <MemberRow key={member.memberId} member={member} color={colors.get(member.memberId.toLowerCase())} />
          ))}
        </Stack>
      </Card.Body>
    </Card>
  );
}

/** The family's name and its members, grouped into parents and kids. */
export function FamilyMembers({ data }: { data: FamilyView }) {
  const parents = data.members.filter((member) => member.role === "parent");
  const kids = data.members.filter((member) => member.role === "kid");
  // The colours each member wears in the family's expense lists and charts.
  const colors = memberColorTokens(data.members);

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <Text as="h2" textStyle="sectionTitle">
        {data.family.name}
      </Text>
      <MemberGroup title="Parents" members={parents} colors={colors} />
      <MemberGroup title="Kids" members={kids} colors={colors} />
    </Stack>
  );
}

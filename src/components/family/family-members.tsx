import { Flex, Stack, Text } from "@chakra-ui/react";

import { MemberSwatch } from "@/components/family/member-swatch";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
import { StatusBadge } from "@/components/ui/status-badge";
import type { FamilyData, FamilyMember } from "@/lib/family/repository";
import { memberColorTokens } from "@/lib/family/member-colors";

const joinedFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "Joined 12 Oct 2026", or an empty string when the date can't be read. */
export function joinedLabel(joinedAt: string): string {
  const date = new Date(joinedAt);
  return Number.isNaN(date.getTime()) ? "" : `Joined ${joinedFormatter.format(date)}`;
}

function MemberRow({ member, color }: { member: FamilyMember; color: string | undefined }) {
  const name = member.displayName ?? member.username ?? "Unnamed";
  const meta = [member.displayName && member.username ? `@${member.username}` : null, joinedLabel(member.joinedAt)]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListRow
      title={
        <Flex as="span" align="center" gap="2" minW="0">
          <MemberSwatch color={color} />
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

function MemberGroup({ title, members, colors }: { title: string; members: FamilyMember[]; colors: Map<string, string> }) {
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
export function FamilyMembers({ data }: { data: FamilyData }) {
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

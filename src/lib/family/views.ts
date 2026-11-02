import type { FamilyData, FamilyInvite, FamilyMember, InvitePreview } from "@/lib/family/repository";

// What the family routes send to the browser (security plan S9). Each view copies the fields a screen
// reads, by name, so a field added to a repository type never reaches a response by accident. The
// repository types keep what only the server needs: the family's id and creation time (calendar and
// to-do writes), each member's auth user id (finance viewing, kid password resets), and an invite's
// creation time and permissions.

/** A member as the browser sees them: `FamilyMember` without the auth user id. */
export type FamilyMemberView = Omit<FamilyMember, "userId">;

/** The caller's family as `GET /api/family` and every family write answer it. */
export type FamilyView = { family: { name: string }; members: FamilyMemberView[] };

/** A pending invite in the parents' list: who made it, for which role, until when. */
export type FamilyInviteView = Pick<FamilyInvite, "inviteId" | "role" | "createdByName" | "expiresAt">;

/** What a code invites the caller to, for the join screen's confirmation. */
export type InvitePreviewView = Pick<InvitePreview, "familyName" | "inviterName" | "role">;

export function familyMemberView(member: FamilyMember): FamilyMemberView {
  const view: FamilyMemberView = {
    memberId: member.memberId,
    role: member.role,
    isCreator: member.isCreator,
    displayName: member.displayName,
    username: member.username,
    currency: member.currency,
    color: member.color,
    avatarUrl: member.avatarUrl,
    joinedAt: member.joinedAt,
  };
  // Hidden fields stay absent (not undefined-valued), so a missing key always means "hidden".
  if (member.lastActiveAt !== undefined) view.lastActiveAt = member.lastActiveAt;
  if (member.permissions !== undefined) view.permissions = member.permissions;
  return view;
}

export function familyView(data: FamilyData | null): FamilyView | null {
  if (!data) return null;
  return { family: { name: data.family.name }, members: data.members.map(familyMemberView) };
}

export function familyInviteView({ inviteId, role, createdByName, expiresAt }: FamilyInvite): FamilyInviteView {
  return { inviteId, role, createdByName, expiresAt };
}

export function invitePreviewView({ familyName, inviterName, role }: InvitePreview): InvitePreviewView {
  return { familyName, inviterName, role };
}

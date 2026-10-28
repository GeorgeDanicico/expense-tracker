import { DomainError } from "@/lib/errors";
import { getCurrentMember } from "@/lib/family/current-member";
import type { CurrentMember, FamilyMember } from "@/lib/family/repository";
import { getRepositories } from "@/lib/repositories";

// Family members as the family tools (to-dos, calendar) name them: by display name or username,
// or "me" for the caller. Never an id, so Claude can't point a tool at someone outside the family.

/**
 * The caller's membership, or a 404 refusal with `noFamilyMessage` for a caller without a family.
 * While the family flag is off `getCurrentMember()` is null too (the tools aren't registered then,
 * so that's only a safety net).
 */
export async function requireMember(noFamilyMessage: string): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) throw new DomainError(noFamilyMessage, 404);
  return member;
}

/** The caller's family's members; none for a caller without a family. */
export async function familyMembers(): Promise<readonly FamilyMember[]> {
  return (await getRepositories().family.getFamily())?.members ?? [];
}

function memberNames(members: readonly FamilyMember[]) {
  return members.map((member) => member.displayName ?? member.username).filter((name) => name !== null);
}

/**
 * The member id for `name`: "me" is the caller, otherwise a member whose display name or username
 * matches case-insensitively. Unknown or ambiguous names are a 422 field error on `field` listing
 * the valid names.
 */
export async function resolveMember(me: CurrentMember, name: string, field: string): Promise<string> {
  const wanted = name.trim().toLowerCase();
  if (wanted === "me") return me.memberId;

  const members = await familyMembers();
  const matches = members.filter((member) =>
    [member.displayName, member.username].some((candidate) => candidate?.trim().toLowerCase() === wanted));
  if (matches.length === 1) return matches[0].memberId;

  const valid = [...memberNames(members).map((member) => `"${member}"`), "\"me\""].join(", ");
  const message = matches.length === 0
    ? `No family member is called "${name}". Use one of: ${valid}.`
    : `More than one family member is called "${name}". Use one of: ${valid}.`;
  throw new DomainError(message, 422, { [field]: [message] });
}

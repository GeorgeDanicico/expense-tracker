import { DomainError } from "@/lib/errors";
import { requireFamilyFeature } from "@/lib/family/feature";
import { hashInviteCode } from "@/lib/family/invite-code";
import { TOO_MANY_ATTEMPTS_MESSAGE, inviteCodeAttempts } from "@/lib/http/rate-limit";
import { json, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { joinFamilySchema } from "@/lib/validation/family";

const JOIN_FAILURE = "Unable to join the family.";

/**
 * Joins the family a code invites the caller to and answers `{ family }` with 201, like
 * `GET /api/family`. 404 for any code that can't be redeemed (it counts toward the caller's limit,
 * shared with `POST /api/family/join/preview`), 409 when the caller is already in a family, and 429
 * without asking the database when they're over the limit. The code travels only in the body and is
 * never logged.
 */
export const POST = withUser(async (request, user) => {
  requireFamilyFeature();
  if (inviteCodeAttempts.isLimited(user.id)) return json({ error: TOO_MANY_ATTEMPTS_MESSAGE }, 429);
  const { code } = await parseBody(request, joinFamilySchema, "Enter the 8-character invite code.");

  const repository = getRepositories().family;
  try {
    await repository.redeemInvite(hashInviteCode(code));
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) inviteCodeAttempts.recordFailure(user.id);
    throw error;
  }

  // `redeem_family_invite` returns only the member id; read the family back to answer like GET /api/family.
  const family = await repository.getFamily();
  if (!family) throw new Error(JOIN_FAILURE);

  return json({ family }, 201);
}, { failure: JOIN_FAILURE });

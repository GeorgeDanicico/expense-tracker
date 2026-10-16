import { requireFamilyFeature } from "@/lib/family/feature";
import { hashInviteCode } from "@/lib/family/invite-code";
import { TOO_MANY_ATTEMPTS_MESSAGE, inviteCodeAttempts } from "@/lib/http/rate-limit";
import { json, notFound, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { joinFamilySchema } from "@/lib/validation/family";

/**
 * What a code invites the caller to: `{ familyName, inviterName, role, permissions, expiresAt }`, or
 * 404 for any code that can't be redeemed, without saying why. A code that doesn't work counts toward
 * the caller's limit (shared with `POST /api/family/join`); over it, the answer is 429 without asking
 * the database. The code travels only in the body and is never logged.
 */
export const POST = withUser(async (request, user) => {
  requireFamilyFeature();
  if (inviteCodeAttempts.isLimited(user.id)) return json({ error: TOO_MANY_ATTEMPTS_MESSAGE }, 429);
  const { code } = await parseBody(request, joinFamilySchema, "Enter the 8-character invite code.");

  const preview = await getRepositories().family.previewInvite(hashInviteCode(code));
  if (!preview) {
    inviteCodeAttempts.recordFailure(user.id);
    notFound("This code isn't valid anymore.");
  }

  return json(preview);
}, { failure: "Unable to check the invite code." });

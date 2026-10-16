import type { NextRequest } from "next/server";

import { requireFamilyFeature } from "@/lib/family/feature";
import { withFreshInviteCode } from "@/lib/family/invite-code";
import { siteOrigin } from "@/lib/http/origin";
import { json, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { createInviteSchema } from "@/lib/validation/family";

/** The family's pending invites, for parents. A kid or a user without a family gets 403. */
export const GET = withUser(async () => {
  requireFamilyFeature();
  return json({ invites: await getRepositories().family.listInvites() });
}, { failure: "Unable to load the invites." });

/**
 * Creates an invite and answers `{ inviteId, code, url, expiresAt }` with 201. This is the only time the
 * plain code leaves the server: only its hash is stored, and it is never logged.
 */
export const POST = withUser<NextRequest>(async (request) => {
  requireFamilyFeature();
  const invite = await parseBody(request, createInviteSchema, "Check the invite and try again.");

  const repository = getRepositories().family;
  const { code, result } = await withFreshInviteCode((codeHash) => repository.createInvite({ ...invite, codeHash }));

  return json(
    {
      inviteId: result.inviteId,
      code,
      url: `${siteOrigin(request)}/join/${code}`,
      expiresAt: result.expiresAt,
    },
    201,
  );
}, { failure: "Unable to create the invite." });

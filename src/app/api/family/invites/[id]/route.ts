import { requireFamilyFeature } from "@/lib/family/feature";
import { noContent, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

/** Revokes an invite of the caller's family, for parents. Answers 204, also for one already revoked or used. */
export const DELETE = withUser(async (_request, _user, context: RouteContext<"/api/family/invites/[id]">) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid invite identifier.");
  await getRepositories().family.revokeInvite(id);
  return noContent();
}, { failure: "Unable to revoke the invite." });

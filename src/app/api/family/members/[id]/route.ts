import { requireFamilyFeature } from "@/lib/family/feature";
import { noContent, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

export const DELETE = withUser(async (_request, _user, context: { params: Promise<{ id: string }> }) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid member identifier.");

  await getRepositories().family.removeMember(id);
  return noContent();
}, { failure: "Unable to remove the member." });

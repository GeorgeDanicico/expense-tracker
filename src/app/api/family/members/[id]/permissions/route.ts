import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { memberPermissionsSchema } from "@/lib/validation/family";

const FAILURE = "Unable to save the permissions.";

export const PATCH = withUser(async (request, _user, context: { params: Promise<{ id: string }> }) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid member identifier.");
  const { permissions } = await parseBody(request, memberPermissionsSchema, "Check the permissions and try again.");

  const repository = getRepositories().family;
  await repository.setMemberPermissions(id, permissions);
  // `set_member_permissions` returns nothing; answer with the updated family, as GET /api/family does.
  const family = await repository.getFamily();
  if (!family) throw new Error(FAILURE);

  return json({ family });
}, { failure: FAILURE });

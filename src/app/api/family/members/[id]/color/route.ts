import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { memberColorSchema } from "@/lib/validation/family";

const FAILURE = "Unable to save the colour.";

export const PATCH = withUser(async (request, _user, context: { params: Promise<{ id: string }> }) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid member identifier.");
  const { color } = await parseBody(request, memberColorSchema, "Choose one of the eight colours.");

  const repository = getRepositories().family;
  await repository.setMemberColor(id, color);
  // `set_member_color` returns nothing; answer with the updated family, as GET /api/family does.
  const family = await repository.getFamily();
  if (!family) throw new Error(FAILURE);

  return json({ family });
}, { failure: FAILURE });

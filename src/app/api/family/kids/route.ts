import { requireFamilyFeature } from "@/lib/family/feature";
import { createKidAccount } from "@/lib/family/service";
import { json, readJson, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

const CREATE_FAILURE = "Unable to create the kid's account.";

export const POST = withUser(async (request) => {
  requireFamilyFeature();
  // The service checks that the caller is a parent before it validates the body.
  await createKidAccount(await readJson(request));

  // Answer with the updated family, the same shape as `GET /api/family`, so the page can refresh.
  const family = await getRepositories().family.getFamily();
  if (!family) throw new Error(CREATE_FAILURE);

  return json({ family }, 201);
}, { failure: CREATE_FAILURE });

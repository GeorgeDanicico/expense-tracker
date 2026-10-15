import { isFamilyEnabled } from "@/lib/features";
import { json, notFound, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { createFamilySchema } from "@/lib/validation/family";

const CREATE_FAILURE = "Unable to create the family.";

/** While the family flag is off the route doesn't exist: 404 before anything is queried. */
function requireFamilyFeature() {
  if (!isFamilyEnabled()) notFound("Not found.");
}

export const GET = withUser(async () => {
  requireFamilyFeature();
  return json({ family: await getRepositories().family.getFamily() });
}, { failure: "Unable to load the family." });

export const POST = withUser(async (request) => {
  requireFamilyFeature();
  const { name } = await parseBody(request, createFamilySchema, "Check the family name and try again.");

  const repository = getRepositories().family;
  await repository.createFamily(name);
  // `create_family` returns only the id; read the family back to answer with the same shape as GET.
  const family = await repository.getFamily();
  if (!family) throw new Error(CREATE_FAILURE);

  return json({ family }, 201);
}, { failure: CREATE_FAILURE });

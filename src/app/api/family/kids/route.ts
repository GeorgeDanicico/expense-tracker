import { createKidAccount } from "@/lib/family/service";
import { familyView } from "@/lib/family/views";
import { withParent } from "@/lib/http/permission";
import { json, readJson } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

const CREATE_FAILURE = "Unable to create the kid's account.";

/** For parents only (`withParent`): the account is created with the admin client, which no SQL rule sees. */
export const POST = withParent(async (request, _user, _context, parent) => {
  await createKidAccount(parent, await readJson(request));

  // Answer with the updated family, the same shape as `GET /api/family`, so the page can refresh.
  const family = await getRepositories().family.getFamily();
  if (!family) throw new Error(CREATE_FAILURE);

  return json({ family: familyView(family) }, 201);
}, { failure: CREATE_FAILURE });

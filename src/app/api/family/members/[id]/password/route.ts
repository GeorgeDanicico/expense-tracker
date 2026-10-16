import { getAuthAdmin } from "@/lib/auth";
import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { resetKidPasswordSchema } from "@/lib/validation/family";

const FAILURE = "Unable to reset the password.";

export const POST = withUser(async (request, _user, context: { params: Promise<{ id: string }> }) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid member identifier.");
  const { password } = await parseBody(request, resetKidPasswordSchema, "Check the password and try again.");

  // Step 1, as the parent: the SQL function refuses anyone who isn't a parent of this kid, so it is
  // the permission check. It also makes the kid choose a new password at next sign-in.
  const kidUserId = await getRepositories().family.requirePasswordChange(id);
  // Step 2, only after step 1 succeeded: the admin client bypasses every database rule.
  await getAuthAdmin().setPassword(kidUserId, password);

  return json({ success: true });
}, { failure: FAILURE });

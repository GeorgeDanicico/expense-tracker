import { requireFamilyFeature } from "@/lib/family/feature";
import { noContent, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

/** Marks one of the caller's notices as seen. Answers 404 for an unknown id or another user's notice. */
export const POST = withUser(async (_request, _user, context: RouteContext<"/api/account/notices/[id]/dismiss">) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, "Invalid notice identifier.");
  await getRepositories().notices.dismiss(id);
  return noContent();
}, { failure: "Unable to dismiss the notice." });

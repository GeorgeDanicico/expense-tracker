import { requireFamilyFeature } from "@/lib/family/feature";
import { json, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

/** The caller's unseen notices, oldest first. Answers 404 while the family flag is off. */
export const GET = withUser(async () => {
  requireFamilyFeature();
  return json({ notices: await getRepositories().notices.listUnseen() });
}, { failure: "Unable to load your notices." });

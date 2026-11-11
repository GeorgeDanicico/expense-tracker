import "server-only";

import type { FamilyResponse } from "@/lib/api/keys";
import { requireFamilyFeature } from "@/lib/family/feature";
import { familyView } from "@/lib/family/views";
import { getRepositories } from "@/lib/repositories";

/** `GET /api/family`'s answer: 404 while the family flag is off, `{ family: null }` without a family. The route and the pages' server renders both call it (PF7). */
export async function loadFamily(): Promise<FamilyResponse> {
  requireFamilyFeature();
  return { family: familyView(await getRepositories().family.getFamily()) };
}

import "server-only";

import { isFamilyEnabled } from "@/lib/features";
import { notFound } from "@/lib/http/route";

/**
 * While the family flag is off, family routes don't exist: call this first in every family route
 * handler, so it answers 404 before anything is parsed or queried.
 */
export function requireFamilyFeature() {
  if (!isFamilyEnabled()) notFound("Not found.");
}

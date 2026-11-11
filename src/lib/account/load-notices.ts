import "server-only";

import type { NoticesResponse } from "@/lib/api/keys";
import { requireFamilyFeature } from "@/lib/family/feature";
import { getRepositories } from "@/lib/repositories";

/** `GET /api/account/notices`'s answer: the caller's unseen notices, oldest first. The route and the `(app)` layout both call it (PF8). */
export async function loadNotices(): Promise<NoticesResponse> {
  requireFamilyFeature();
  return { notices: await getRepositories().notices.listUnseen() };
}

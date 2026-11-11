import { loadNotices } from "@/lib/account/load-notices";
import { json, withUser } from "@/lib/http/route";

/** The caller's unseen notices, oldest first. Answers 404 while the family flag is off. */
export const GET = withUser(async () => json(await loadNotices()), { failure: "Unable to load your notices." });

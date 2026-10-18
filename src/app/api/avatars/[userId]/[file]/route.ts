import { avatarPathFromUrlParts } from "@/lib/avatars/paths";
import { notFound, parseId, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

const NOT_FOUND = "That picture wasn't found.";

/**
 * A profile picture, for the caller and their family only (the bucket's read policy decides; anyone
 * else gets the same 404 as a missing file). Each URL names one upload and never changes, so the
 * browser may keep it for a year. `private`: shared caches must not store it.
 * The URL has no `.webp` extension on purpose: `src/proxy.ts` skips such paths, so they would miss
 * the session refresh.
 */
export const GET = withUser(async (_request, _user, context: { params: Promise<{ userId: string; file: string }> }) => {
  const { userId, file } = await context.params;
  const path = avatarPathFromUrlParts(parseId(userId, NOT_FOUND), parseId(file, NOT_FOUND));

  const bytes = await getRepositories().avatars.read(path);
  if (!bytes) notFound(NOT_FOUND);

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}, { failure: "Unable to load the picture." });

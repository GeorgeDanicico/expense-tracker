import { AVATAR_MAX_UPLOAD_BYTES, sniffImageType, toAvatarWebp } from "@/lib/avatars/image";
import { avatarUrl } from "@/lib/avatars/paths";
import { readBodyWithLimit } from "@/lib/http/body";
import { avatarUploadAttempts } from "@/lib/http/rate-limit";
import { HttpError, json, noContent, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png"]);
const WRONG_TYPE = "Choose a JPG or PNG image.";
const TOO_LARGE = "Choose an image under 5 MB.";
const TOO_MANY = "You've changed your picture a lot recently. Try again in an hour.";

/**
 * Sets the caller's picture. The body is the raw image (not multipart), with `Content-Type`
 * `image/jpeg` or `image/png`. Answers `{ avatarUrl }`.
 * 415 for another type (by header or by content), 413 over 5 MB, 422 for an image that can't be
 * decoded or is over 40 megapixels, 429 past 20 attempts an hour.
 *
 * Keep the body raw: `multipart/form-data` would make this a "simple" request that another site's
 * plain HTML form could send. An `image/*` body needs a CORS preflight, which we never grant.
 */
export const PUT = withUser(async (request, user) => {
  if (avatarUploadAttempts.isLimited(user.id)) throw new HttpError(429, TOO_MANY);
  avatarUploadAttempts.recordFailure(user.id);

  // Refuse before reading the body when the header already says it's something else.
  const declaredType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!declaredType || !ACCEPTED_TYPES.has(declaredType)) throw new HttpError(415, WRONG_TYPE);

  const bytes = await readBodyWithLimit(request, AVATAR_MAX_UPLOAD_BYTES, TOO_LARGE);
  // The content decides, not the header: a PNG sent as image/jpeg is still a PNG, and is fine.
  if (!sniffImageType(bytes)) throw new HttpError(415, WRONG_TYPE);

  const webp = await toAvatarWebp(bytes);
  // Always the caller's own picture: the repository finds the caller itself.
  const path = await getRepositories().avatars.replace(webp);
  return json({ avatarUrl: avatarUrl(path) });
}, { failure: "Unable to save your picture. Please try again." });

/** Removes the caller's picture. 204, also when there was none. */
export const DELETE = withUser(async () => {
  await getRepositories().avatars.remove();
  return noContent();
}, { failure: "Unable to remove your picture. Please try again." });

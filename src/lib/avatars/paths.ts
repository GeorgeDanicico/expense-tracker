const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AVATAR_PATH = new RegExp(`^(${UUID})/(${UUID})\\.webp$`);

/** API prefix that serves avatars; see `src/app/api/avatars/[userId]/[file]/route.ts`. */
export const AVATARS_API_PREFIX = "/api/avatars";

/** A fresh storage key for `userId`'s next avatar. A new uuid each time, so cached URLs never go stale. */
export function newAvatarPath(userId: string): string {
  return `${userId.toLowerCase()}/${crypto.randomUUID()}.webp`;
}

/** The storage key that `/api/avatars/<userId>/<fileId>` names. Both ids must already be validated. */
export function avatarPathFromUrlParts(userId: string, fileId: string): string {
  return `${userId.toLowerCase()}/${fileId.toLowerCase()}.webp`;
}

/** The URL the app shows for a storage key, or `null` for no key or a malformed one. */
export function avatarUrl(path: string | null | undefined): string | null {
  const match = path?.match(AVATAR_PATH);
  return match ? `${AVATARS_API_PREFIX}/${match[1]}/${match[2]}` : null;
}

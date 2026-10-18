/**
 * Profile pictures. Get it from `getRepositories()`; never import an implementation.
 *
 * Only a picture's owner can change it. `replace` and `remove` take **no user id**: they act on the
 * signed-in caller, whom the implementation looks up itself, so no caller can aim them at someone
 * else. Keep it that way: don't add a write method that takes a user id.
 *
 * SECURITY: the writes use the server's secret key, because signed-in users have no write access to
 * the bucket or to `profiles.avatar_path` (so nobody can skip the server's image checks). The
 * caller lookup is what keeps those writes on the caller's own picture. `getPath` and `read` act as
 * the caller through their own session.
 */
export interface AvatarRepository {
  /** The caller's own avatar key, or `null` when they have none (or no profile row). */
  getPath(userId: string): Promise<string | null>;
  /**
   * The WebP bytes at `path`, or `null` when the object doesn't exist **or the caller may not see
   * it** (not themselves and not in their family). The two are indistinguishable on purpose.
   */
  read(path: string): Promise<ArrayBuffer | null>;
  /**
   * Stores `webp` (already re-encoded by `toAvatarWebp`) as the **caller's** picture under a new key,
   * points their profile at it, deletes their previous picture, and returns the new key. If the
   * profile can't be updated, the new object is deleted again. A failed delete of the old object is
   * logged, not thrown. Throws when nobody is signed in.
   */
  replace(webp: Uint8Array): Promise<string>;
  /** Clears the **caller's** picture and deletes its object. Does nothing when there is none. Throws when nobody is signed in. */
  remove(): Promise<void>;
}

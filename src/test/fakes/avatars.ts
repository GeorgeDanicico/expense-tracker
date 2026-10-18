import { newAvatarPath } from "@/lib/avatars/paths";
import type { AvatarRepository } from "@/lib/avatars/repository";

/**
 * In-memory `AvatarRepository`. `paths` maps user id → key, `files` maps key → bytes. `hidden` holds
 * keys the caller may not see (another family's): `read` answers `null` for them, like the bucket
 * policy. `replace` and `remove` act on `caller`, the signed-in user (`testUser` from `@/test/route`
 * by default; set it to match `signedInAs`), and record that id, like the real one.
 */
export class FakeAvatarRepository implements AvatarRepository {
  readonly paths = new Map<string, string>();
  readonly files = new Map<string, Uint8Array>();
  readonly hidden = new Set<string>();
  readonly replaced: string[] = [];
  readonly removed: string[] = [];
  caller = { userId: "10000000-0000-4000-8000-000000000001" };

  async getPath(userId: string) {
    return this.paths.get(userId) ?? null;
  }

  async read(path: string) {
    if (this.hidden.has(path)) return null;
    const bytes = this.files.get(path);
    return bytes ? (bytes.slice().buffer as ArrayBuffer) : null;
  }

  async replace(webp: Uint8Array) {
    const { userId } = this.caller;
    this.replaced.push(userId);
    const previous = this.paths.get(userId);
    const path = newAvatarPath(userId);
    this.files.set(path, webp);
    this.paths.set(userId, path);
    if (previous) this.files.delete(previous);
    return path;
  }

  async remove() {
    const { userId } = this.caller;
    this.removed.push(userId);
    const previous = this.paths.get(userId);
    this.paths.delete(userId);
    if (previous) this.files.delete(previous);
  }
}

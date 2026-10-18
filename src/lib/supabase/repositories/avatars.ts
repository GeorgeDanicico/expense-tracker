import "server-only";

import { getAuthenticatedUser } from "@/lib/auth";
import { newAvatarPath } from "@/lib/avatars/paths";
import type { AvatarRepository } from "@/lib/avatars/repository";
import { type AdminClient, createAdminClient } from "@/lib/supabase/admin-client";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "avatars";
const LOAD_ERROR = "Unable to load your profile picture.";
const SAVE_ERROR = "Unable to save your picture. Please try again.";
const REMOVE_ERROR = "Unable to remove your picture. Please try again.";

async function currentPath(admin: AdminClient, userId: string, failure: string): Promise<string | null> {
  const { data, error } = await admin.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
  if (error) throw new Error(failure);
  return data?.avatar_path ?? null;
}

/**
 * The signed-in caller's id, from their own session (cookie or bearer), never from an argument.
 * This is what limits the secret-key writes below to the caller's own picture.
 */
async function callerId(failure: string): Promise<string> {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error(failure);
  return user.id;
}

/** Deletes an object, logging instead of throwing: a leftover file is harmless, a failed request isn't. */
async function removeObject(admin: AdminClient, path: string) {
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) console.error(`Avatars: could not delete ${path}.`);
}

/**
 * `AvatarRepository` on the private `avatars` bucket and `profiles.avatar_path`.
 *
 * SECURITY: `replace` and `remove` use the secret key, and only ever on the folder and profile row of
 * the caller that `callerId` finds from the request's own session. Never give them a user id.
 */
export const supabaseAvatarRepository: AvatarRepository = {
  async getPath(userId) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
    if (error) throw new Error(LOAD_ERROR);
    return data?.avatar_path ?? null;
  },

  /** As the caller: the bucket's select policy hides other families' pictures, which Storage reports as an error. */
  async read(path) {
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return data.arrayBuffer();
  },

  /**
   * Upload first, then point the profile at the new key, then delete the old object. A failure at any
   * step leaves the profile pointing at a file that exists: the worst case is an orphaned object.
   */
  async replace(webp) {
    const userId = await callerId(SAVE_ERROR);
    // SECURITY: secret key, only ever on the caller's own folder and profile row.
    const admin = createAdminClient();
    const previous = await currentPath(admin, userId, SAVE_ERROR);
    const path = newAvatarPath(userId);

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, webp, { contentType: "image/webp", upsert: false });
    if (uploadError) throw new Error(SAVE_ERROR);

    // Upsert: a user may not have a profile row yet.
    const { error: writeError } = await admin
      .from("profiles")
      .upsert({ id: userId, avatar_path: path }, { onConflict: "id" });
    if (writeError) {
      await removeObject(admin, path);
      throw new Error(SAVE_ERROR);
    }

    if (previous && previous !== path) await removeObject(admin, previous);
    return path;
  },

  async remove() {
    const userId = await callerId(REMOVE_ERROR);
    // SECURITY: secret key, only ever on the caller's own folder and profile row.
    const admin = createAdminClient();
    const previous = await currentPath(admin, userId, REMOVE_ERROR);
    if (!previous) return;

    const { error } = await admin.from("profiles").update({ avatar_path: null }).eq("id", userId);
    if (error) throw new Error(REMOVE_ERROR);
    await removeObject(admin, previous);
  },
};

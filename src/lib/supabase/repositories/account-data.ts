import "server-only";

import type { AccountDataRepository, ExportRow } from "@/lib/account/data-repository";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { changingFamily } from "@/lib/supabase/repositories/family";
import { createClient } from "@/lib/supabase/server";

const DELETE_FAILURE = "Unable to delete your data. Please try again.";
const DELETE_KID_FAILURE = "Unable to delete the kid's account. Please try again.";
const EXPORT_FAILURE = "Unable to prepare your data. Please try again.";

/**
 * `AccountDataRepository` on `delete_my_data()`, `delete_managed_kid_data()` and `export_my_data()`
 * (supabase/migrations/20261102000300_add_account_deletion_and_export.sql), as the request's caller.
 * Their refusals are marked for users, so `translateDatabaseError` passes their messages on. Without
 * the migration, each RPC is unknown: a plain error (500), and nothing is deleted.
 */
export const supabaseAccountDataRepository: AccountDataRepository = {
  // You leave the family.
  deleteMyData: (confirm) => changingFamily(async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_my_data", { p_confirm: confirm });
    if (error) throw translateDatabaseError(error, DELETE_FAILURE);
  }),

  // The kid leaves the family, and the route answers with the family read again.
  deleteManagedKidData: (memberId, confirmName) => changingFamily(async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_managed_kid_data", {
      p_member_id: memberId,
      p_confirm_name: confirmName,
    });
    if (error) throw translateDatabaseError(error, DELETE_KID_FAILURE);
    if (typeof data !== "string") throw new Error(DELETE_KID_FAILURE);
    return data;
  }),

  /**
   * One client for the whole export, made while the request is still being handled: the stream reads
   * its sections after the handler has returned the response.
   */
  async openExport() {
    const supabase = await createClient();
    return {
      async section(section) {
        // One JSON value per call, so PostgREST's row limit never cuts a section short.
        const { data, error } = await supabase.rpc("export_my_data", { p_section: section });
        if (error) throw translateDatabaseError(error, EXPORT_FAILURE);
        if (!Array.isArray(data)) throw new Error(EXPORT_FAILURE);
        return data as ExportRow[];
      },
    };
  },
};

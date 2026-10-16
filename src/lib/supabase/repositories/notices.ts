import "server-only";

import type { AccountNotice, NoticeKind, NoticeRepository } from "@/lib/account/notice-repository";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const LIST_ERROR = "Unable to load your notices.";
const DISMISS_ERROR = "Unable to dismiss the notice.";

function toKind(kind: string): NoticeKind {
  if (kind === "family_deleted" || kind === "removed_from_family") return kind;
  throw new Error(LIST_ERROR);
}

/** `NoticeRepository` on `get_my_notices()` and `dismiss_notice()`, which act as the request's caller. */
export const supabaseNoticeRepository: NoticeRepository = {
  async listUnseen(): Promise<AccountNotice[]> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_my_notices");

    if (error) throw translateDatabaseError(error, LIST_ERROR);
    return (data ?? []).map((row) => ({
      id: row.id,
      kind: toKind(row.kind),
      familyName: row.family_name,
      createdAt: row.created_at,
    }));
  },

  async dismiss(noticeId: string): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("dismiss_notice", { p_notice_id: noticeId });

    if (error) throw translateDatabaseError(error, DISMISS_ERROR);
  },
};

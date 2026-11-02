import "server-only";

import type { AiAccess, AiGateRepository, AiReservation } from "@/lib/ai/repository";
import { getAuthenticatedUser } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { createClient } from "@/lib/supabase/server";

const FLAG_ERROR = "Unable to check whether AI is on.";
const ACCESS_ERROR = "Unable to check your AI settings.";
const RESERVE_ERROR = "Unable to check this month's AI budget.";
const RECORD_ERROR = "Unable to record the AI usage.";
const SWITCH_ERROR = "Unable to turn AI off.";
const OPT_IN_ERROR = "Unable to save your AI setting. Please try again.";
const RECIPIENTS_ERROR = "Unable to find who to tell about the AI budget.";
const NOTIFY_ERROR = "Unable to queue the AI budget notification.";

/** Postgres' unique_violation: here, a `dedupe_key` that's already queued. */
const UNIQUE_VIOLATION = "23505";

const ACCESS_STATUSES: readonly string[] = ["ok", "ai_off", "not_permitted"];

/**
 * The reads that depend on who is asking (the opt-in, the family's total) run as the request's
 * signed-in user, through their session. The gate is passed a user id, so a mismatch with the
 * session is a programming error, not a way to read someone else's numbers.
 */
async function assertCaller(userId: string) {
  const user = await getAuthenticatedUser();
  if (!user || user.id !== userId) throw new Error("The AI gate can only act for the signed-in user.");
}

type ReservationRow = Database["public"]["Functions"]["ai_reserve_budget"]["Returns"][number];

/** A reservation row as the gate reads it; anything the function shouldn't return is an error. */
function toReservation(row: ReservationRow | undefined): AiReservation {
  const spent = (value: number | null | undefined) => {
    if (typeof value !== "number") throw new Error(RESERVE_ERROR);
    return value;
  };
  switch (row?.status) {
    case "ok":
      if (!row.reservation_id) throw new Error(RESERVE_ERROR);
      return { status: "ok", reservationId: row.reservation_id, familySpentMicros: spent(row.family_spent_micros), globalSpentMicros: spent(row.global_spent_micros) };
    case "flag_off":
    case "ai_off":
    case "not_permitted":
      return { status: row.status };
    case "family_budget":
      return { status: "family_budget", familySpentMicros: spent(row.family_spent_micros) };
    case "global_budget":
      return { status: "global_budget", familySpentMicros: spent(row.family_spent_micros), globalSpentMicros: spent(row.global_spent_micros) };
    default:
      throw new Error(RESERVE_ERROR);
  }
}

/**
 * `AiGateRepository` on `app_flags`, `my_ai_access()` (supabase/migrations/20261030000100_create_ai_gate.sql),
 * `ai_reserve_budget()` and `ai_settle_usage()` (20261102000200_close_check_then_write_races.sql),
 * and the notification outbox.
 *
 * As the request's caller, under RLS and the functions' own caller checks: the kill switch and the
 * opt-in. With the admin client, because only the server may do them: reserving and settling (they
 * write the ledger and read everyone's month), turning the switch off, finding a family's parents and
 * queuing notifications (the outbox has no policies for signed-in users).
 */
export const supabaseAiGateRepository: AiGateRepository = {
  async isEnabled() {
    const supabase = await createClient();
    const { data, error } = await supabase.from("app_flags").select("value").eq("key", "ai_enabled").maybeSingle();
    if (error) throw translateDatabaseError(error, FLAG_ERROR);
    // A missing or odd flag counts as off.
    return data?.value === true;
  },

  async access(userId): Promise<AiAccess> {
    await assertCaller(userId);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("my_ai_access");
    if (error) throw translateDatabaseError(error, ACCESS_ERROR);
    if (typeof data !== "string" || !ACCESS_STATUSES.includes(data)) throw new Error(ACCESS_ERROR);
    return data as AiAccess;
  },

  /**
   * On the caller's own profile row, under RLS; the switch guard trigger refuses a kid without the
   * `ai` permission (42501, a 403 here).
   */
  async setOptIn(userId, enabled) {
    await assertCaller(userId);
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").update({ ai_enabled: enabled }).eq("id", userId).select("id");
    if (error) throw translateDatabaseError(error, OPT_IN_ERROR);
    // Every user has a profile row (handle_new_user); no row updated means something is wrong.
    if (!data?.length) throw new Error(OPT_IN_ERROR);
  },

  /**
   * `ai_reserve_budget`, with the admin client: it writes the ledger and reads everyone's month. The
   * user is checked against the session first, so the gate still only acts for the signed-in user.
   */
  async reserve(request): Promise<AiReservation> {
    await assertCaller(request.userId);
    const { data, error } = await createAdminClient().rpc("ai_reserve_budget", {
      p_user_id: request.userId,
      p_feature: request.feature,
      p_provider: request.provider,
      p_model: request.model,
      p_estimated_micros: request.estimatedMicros,
      p_month_start: request.monthStart.toISOString(),
      p_family_limit_micros: request.familyLimitMicros,
      p_global_limit_micros: request.globalLimitMicros,
    });
    if (error) throw translateDatabaseError(error, RESERVE_ERROR);
    return toReservation(data?.[0]);
  },

  async settle(settlement) {
    const { data, error } = await createAdminClient().rpc("ai_settle_usage", {
      p_reservation_id: settlement.reservationId,
      p_user_id: settlement.userId,
      p_input_tokens: settlement.inputTokens,
      p_output_tokens: settlement.outputTokens,
      p_cached_input_tokens: settlement.cachedInputTokens,
      p_cost_micros: settlement.costMicros,
      p_outcome: settlement.outcome,
      p_month_start: settlement.monthStart.toISOString(),
    });
    // Not translated into a status: a reservation that can't be settled is the server's problem.
    if (error) throw new Error(RECORD_ERROR);
    const row = data?.[0];
    if (typeof row?.family_spent_micros !== "number" || typeof row.global_spent_micros !== "number") throw new Error(RECORD_ERROR);
    return { familySpentMicros: row.family_spent_micros, globalSpentMicros: row.global_spent_micros };
  },

  async setEnabled(enabled) {
    const { error } = await createAdminClient().rpc("set_app_flag", { p_key: "ai_enabled", p_value: enabled });
    if (error) throw translateDatabaseError(error, SWITCH_ERROR);
  },

  async budgetRecipients(userId) {
    const admin = createAdminClient();
    const membership = await admin.from("family_members").select("family_id").eq("user_id", userId).maybeSingle();
    if (membership.error) throw translateDatabaseError(membership.error, RECIPIENTS_ERROR);
    const familyId = membership.data?.family_id ?? null;
    if (!familyId) return { familyId, userIds: [userId] };

    const parents = await admin.from("family_members").select("user_id").eq("family_id", familyId).eq("role", "parent");
    if (parents.error) throw translateDatabaseError(parents.error, RECIPIENTS_ERROR);
    const userIds = parents.data.map((parent) => parent.user_id);
    // A family always has a parent; the user is told if it somehow has none.
    return { familyId, userIds: userIds.length > 0 ? userIds : [userId] };
  },

  async enqueueNotification({ userId, kind, payload, dedupeKey }) {
    const { error } = await createAdminClient()
      .from("notifications")
      .insert({ user_id: userId, kind, payload, dedupe_key: dedupeKey });
    if (!error) return "queued";
    if (error.code === UNIQUE_VIOLATION) return "duplicate";
    throw translateDatabaseError(error, NOTIFY_ERROR);
  },
};

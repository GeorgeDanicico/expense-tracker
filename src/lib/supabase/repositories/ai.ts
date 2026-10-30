import "server-only";

import type { AiAccess, AiGateRepository } from "@/lib/ai/repository";
import { getAuthenticatedUser } from "@/lib/auth";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { createClient } from "@/lib/supabase/server";

const FLAG_ERROR = "Unable to check whether AI is on.";
const ACCESS_ERROR = "Unable to check your AI settings.";
const SPEND_ERROR = "Unable to check this month's AI spend.";
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

/**
 * `AiGateRepository` on `app_flags`, `ai_usage`, `my_ai_access()`, `ai_family_spend()` and
 * `ai_global_spend()` (supabase/migrations/20261030000100_create_ai_gate.sql), and the notification
 * outbox.
 *
 * As the request's caller, under RLS and the functions' own caller checks: the kill switch, the
 * opt-in and the family's spend. With the admin client, because only the server may do them: the
 * global spend, writing the ledger, turning the switch off, finding a family's parents and queuing
 * notifications (the outbox has no policies for signed-in users).
 */
export const supabaseAiGateRepository: AiGateRepository = {
  async isEnabled() {
    const supabase = await createClient();
    const { data, error } = await supabase.from("app_flags").select("value").eq("key", "ai_enabled").maybeSingle();
    if (error) throw new Error(FLAG_ERROR);
    // A missing or odd flag counts as off.
    return data?.value === true;
  },

  async access(userId): Promise<AiAccess> {
    await assertCaller(userId);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("my_ai_access");
    if (error || typeof data !== "string" || !ACCESS_STATUSES.includes(data)) throw new Error(ACCESS_ERROR);
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

  async familySpendMicros(userId, monthStart) {
    await assertCaller(userId);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ai_family_spend", { p_month_start: monthStart.toISOString() });
    if (error || typeof data !== "number") throw new Error(SPEND_ERROR);
    return data;
  },

  async globalSpendMicros(monthStart) {
    const { data, error } = await createAdminClient().rpc("ai_global_spend", { p_month_start: monthStart.toISOString() });
    if (error || typeof data !== "number") throw new Error(SPEND_ERROR);
    return data;
  },

  /** The family is the user's at this moment, looked up just before the insert. */
  async insertUsage(record) {
    const admin = createAdminClient();
    const membership = await admin.from("family_members").select("family_id").eq("user_id", record.userId).maybeSingle();
    if (membership.error) throw new Error(RECORD_ERROR);

    const { error } = await admin.from("ai_usage").insert({
      user_id: record.userId,
      family_id: membership.data?.family_id ?? null,
      feature: record.feature,
      provider: record.provider,
      model: record.model,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cached_input_tokens: record.cachedInputTokens,
      cost_micros: record.costMicros,
      outcome: record.outcome,
    });
    if (error) throw new Error(RECORD_ERROR);
  },

  async setEnabled(enabled) {
    const { error } = await createAdminClient().rpc("set_app_flag", { p_key: "ai_enabled", p_value: enabled });
    if (error) throw new Error(SWITCH_ERROR);
  },

  async budgetRecipients(userId) {
    const admin = createAdminClient();
    const membership = await admin.from("family_members").select("family_id").eq("user_id", userId).maybeSingle();
    if (membership.error) throw new Error(RECIPIENTS_ERROR);
    const familyId = membership.data?.family_id ?? null;
    if (!familyId) return { familyId, userIds: [userId] };

    const parents = await admin.from("family_members").select("user_id").eq("family_id", familyId).eq("role", "parent");
    if (parents.error) throw new Error(RECIPIENTS_ERROR);
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
    throw new Error(NOTIFY_ERROR);
  },
};

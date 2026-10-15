import "server-only";

import type { Database } from "@/lib/database.types";
import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { ExpenseTabRepository } from "@/lib/expenses/tab-repository";
import type { ExpenseTab, ExpenseTabInput } from "@/lib/expenses/tabs";
import { createClient } from "@/lib/supabase/server";

const TAB_COLUMNS = "id, name, category_keys, subtype_keys, created_at, updated_at";

function toExpenseTab(row: Omit<Database["public"]["Tables"]["expense_tabs"]["Row"], "user_id">): ExpenseTab {
  return {
    id: row.id,
    name: row.name,
    categoryKeys: row.category_keys as ExpenseCategory[],
    subtypeKeys: row.subtype_keys as ExpenseSubtype[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tabValues(input: ExpenseTabInput) {
  return { name: input.name, category_keys: input.categoryKeys, subtype_keys: input.subtypeKeys };
}

/**
 * `ExpenseTabRepository` on the `expense_tabs` table. Every query filters by `user_id` itself instead
 * of relying on RLS, so the user's own pages stay theirs once parents may read family rows (F43).
 * Its errors stay plain `Error`s (500s), as before the repository existed.
 */
export const supabaseExpenseTabRepository: ExpenseTabRepository = {
  async list(userId) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("expense_tabs").select(TAB_COLUMNS)
      .eq("user_id", userId).order("created_at").order("id");
    if (error) throw new Error("Unable to load expense tabs.");
    return data.map(toExpenseTab);
  },

  async get(userId, id) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("expense_tabs").select(TAB_COLUMNS)
      .eq("user_id", userId).eq("id", id).maybeSingle();
    if (error) throw new Error("Unable to load expense tab.");
    return data ? toExpenseTab(data) : null;
  },

  /** The owner comes from `userId`, never from the input. */
  async create(userId, input) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("expense_tabs")
      .insert({ ...tabValues(input), user_id: userId }).select(TAB_COLUMNS).single();
    if (error) throw new Error("Unable to save expense tab.");
    return toExpenseTab(data);
  },

  async update(userId, id, input) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("expense_tabs").update(tabValues(input))
      .eq("user_id", userId).eq("id", id).select(TAB_COLUMNS).maybeSingle();
    if (error) throw new Error("Unable to save expense tab.");
    return data ? toExpenseTab(data) : null;
  },

  async delete(userId, id) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("expense_tabs").delete()
      .eq("user_id", userId).eq("id", id).select("id").maybeSingle();
    if (error) throw new Error("Unable to delete expense tab.");
    return data !== null;
  },
};

import "server-only";

import type { Database } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import type { NetWorthRepository } from "@/lib/net-worth/repository";
import {
  NET_WORTH_ITEM_KINDS,
  type NetWorthItemKind,
  type NetWorthManualItemSource,
  type NetWorthValuation,
} from "@/lib/net-worth/types";
import { createClient } from "@/lib/supabase/server";

const MAX_ACTIVE_ITEMS = 500;

type Tables = Database["public"]["Tables"];

const VALUATION_COLUMNS = "id, item_id, value, valued_on";
const ITEM_COLUMNS = "id, name, kind, category, currency, purchase_amount, archived_at";
const OWNED_ITEM_COLUMNS = "id, kind, category, archived_at";

type NetWorthValuationRow = Tables["net_worth_valuations"]["Row"];

/** Embedded selects are untyped because the generated types declare no relationships. */
type NetWorthItemRow = Omit<Tables["net_worth_items"]["Row"], "user_id"> & {
  net_worth_valuations: NetWorthValuationRow[] | null;
};

function parseItemKind(value: string): NetWorthItemKind {
  if (!NET_WORTH_ITEM_KINDS.includes(value as NetWorthItemKind)) {
    throw new Error("Unable to load net-worth items.");
  }
  return value as NetWorthItemKind;
}

function toValuation(row: NetWorthValuationRow): NetWorthValuation {
  return {
    id: row.id,
    itemId: row.item_id,
    value: String(row.value),
    valuedOn: row.valued_on,
  };
}

function toManualItem(row: NetWorthItemRow): NetWorthManualItemSource {
  return {
    id: row.id,
    name: row.name,
    kind: parseItemKind(row.kind),
    category: row.category,
    currency: row.currency,
    purchaseAmount: row.purchase_amount === null ? null : String(row.purchase_amount),
    archivedAt: row.archived_at,
    valuations: (row.net_worth_valuations ?? [])
      .map(toValuation)
      .sort((left, right) => right.valuedOn.localeCompare(left.valuedOn) || right.id.localeCompare(left.id)),
  };
}

/**
 * `NetWorthRepository` on the `net_worth_items` and `net_worth_valuations` tables. Every read filters
 * by owner: items by `user_id`, and valuations (which have no `user_id`) through their owner's item.
 */
export const supabaseNetWorthRepository: NetWorthRepository = {
  async listActiveItems(userId) {
    const supabase = await createClient();
    // The valuations are embedded under the owner's items, so they are filtered through them.
    const { data, error } = await supabase
      .from("net_worth_items")
      .select(`${ITEM_COLUMNS}, net_worth_valuations(${VALUATION_COLUMNS})`)
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .order("valued_on", {
        foreignTable: "net_worth_valuations",
        ascending: false,
      })
      .order("id", {
        foreignTable: "net_worth_valuations",
        ascending: false,
      })
      .limit(MAX_ACTIVE_ITEMS)
      .limit(2, { foreignTable: "net_worth_valuations" });

    if (error) throw new Error("Unable to load net-worth items.");
    return (data as unknown as NetWorthItemRow[]).map(toManualItem);
  },

  async getItem(userId, itemId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("net_worth_items")
      .select(OWNED_ITEM_COLUMNS)
      .eq("id", itemId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error("Unable to load the net-worth item.");
    if (!data) return null;
    // The table's check constraint limits `kind` to the known kinds.
    return { id: data.id, kind: data.kind as NetWorthItemKind, category: data.category, archivedAt: data.archived_at };
  },

  /**
   * Ownership comes from `auth.uid()` inside the `create_net_worth_item_with_valuation` RPC, which
   * inserts the item and its first valuation together; `_userId` is kept for a uniform signature.
   */
  async createItem(_userId, input) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_net_worth_item_with_valuation", {
      p_name: input.name,
      p_kind: input.kind,
      p_category: input.category,
      p_currency: input.currency,
      p_purchase_amount: input.purchaseAmount,
      p_value: input.value,
      p_valued_on: input.valuedOn,
    });

    if (error || !data) {
      if (error?.code === "42501") {
        throw new DomainError("The net-worth item could not be created.", 422);
      }
      throw new Error("The net-worth item could not be created.");
    }

    return { itemId: String(data) };
  },

  async updateItem(userId, itemId, changes) {
    const update: Tables["net_worth_items"]["Update"] = {};
    if (changes.name !== undefined) update.name = changes.name;
    if (changes.category !== undefined) update.category = changes.category;
    if (changes.purchaseAmount !== undefined) update.purchase_amount = changes.purchaseAmount;
    if (changes.archivedAt !== undefined) update.archived_at = changes.archivedAt;

    const supabase = await createClient();
    const { error } = await supabase
      .from("net_worth_items")
      .update(update)
      .eq("id", itemId)
      .eq("user_id", userId);

    if (error) throw new Error("The net-worth item could not be updated.");
  },

  /** An upsert takes no filters; the item's owner is checked by the caller (`getItem`) and by RLS. */
  async saveValuation(_userId, itemId, input) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("net_worth_valuations")
      .upsert(
        { item_id: itemId, value: input.value, valued_on: input.valuedOn },
        { onConflict: "item_id,valued_on" },
      )
      .select(VALUATION_COLUMNS)
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new DomainError("A valuation for this date already exists.", 409);
      }
      throw new Error("The valuation could not be saved.");
    }

    return toValuation(data);
  },

  async updateValuation(userId, valuationId, input) {
    const supabase = await createClient();
    // `!inner` drops a valuation whose item is not the user's, so the lookup filters through the owner's item.
    const { data: existing, error: lookupError } = await supabase
      .from("net_worth_valuations")
      .select("id, item_id, net_worth_items!inner(user_id)")
      .eq("id", valuationId)
      .eq("net_worth_items.user_id", userId)
      .maybeSingle();

    if (lookupError) throw new Error("Unable to load the valuation.");
    if (!existing) return null;
    const { item_id: itemId } = existing as unknown as Pick<NetWorthValuationRow, "id" | "item_id">;

    const { data, error } = await supabase
      .from("net_worth_valuations")
      .update({ value: input.value, valued_on: input.valuedOn })
      .eq("id", valuationId)
      .eq("item_id", itemId)
      .select(VALUATION_COLUMNS)
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        throw new DomainError("A valuation for this date already exists.", 409);
      }
      throw new Error("The valuation could not be corrected.");
    }

    return toValuation(data);
  },
};

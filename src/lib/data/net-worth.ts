import "server-only";

import type { z } from "zod";

import { getInvestmentsOverviewForUser } from "@/lib/data/investments";
import type { Database } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import { buildNetWorthOverview } from "@/lib/net-worth/calculation";
import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import {
  NET_WORTH_ITEM_KINDS,
  type NetWorthItemKind,
  type NetWorthManualItemSource,
  type NetWorthValuation,
} from "@/lib/net-worth/types";
import { createClient } from "@/lib/supabase/server";
import type { netWorthItemPatchSchema, netWorthItemSchema, netWorthValuationSchema } from "@/lib/validation/net-worth";

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

/** Callers normalize an omitted purchase amount to `null` before creating. */
export type NetWorthItemCreateInput = Omit<z.output<typeof netWorthItemSchema>, "purchaseAmount"> & {
  purchaseAmount: string | null;
};
export type NetWorthItemPatchInput = z.output<typeof netWorthItemPatchSchema>;
export type NetWorthValuationInput = z.output<typeof netWorthValuationSchema>;

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

async function queryActiveManualItemsForUser(userId: string) {
  const supabase = await createClient();
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
}

export async function getNetWorthOverviewForUser(userId: string) {
  const investmentsPromise = getInvestmentsOverviewForUser(userId);
  const manualItemsPromise = queryActiveManualItemsForUser(userId);
  const [investments, manualItems] = await Promise.all([investmentsPromise, manualItemsPromise]);

  return buildNetWorthOverview(investments, manualItems);
}

async function queryOwnedItem(userId: string, itemId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("net_worth_items")
    .select(OWNED_ITEM_COLUMNS)
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Unable to load the net-worth item.");
  // The table's check constraint limits `kind` to the known kinds.
  return data && { ...data, kind: data.kind as NetWorthItemKind };
}

/**
 * Ownership comes from `auth.uid()` inside the `create_net_worth_item_with_valuation` RPC, which
 * inserts the item and its first valuation together; `_userId` is kept for a uniform signature.
 */
export async function createNetWorthItemForUser(
  _userId: string,
  input: NetWorthItemCreateInput,
) {
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
}

export async function updateNetWorthItemForUser(
  userId: string,
  itemId: string,
  input: NetWorthItemPatchInput,
) {
  const existing = await queryOwnedItem(userId, itemId);
  if (!existing) return false;

  if (
    !purchaseAmountAllowed(existing.kind, input.category ?? existing.category)
    && input.purchaseAmount !== undefined
    && input.purchaseAmount !== null
  ) {
    throw new DomainError(
      "Purchase amount is only available for non-cash assets.",
      422,
      { purchaseAmount: ["Purchase amount is only available for non-cash assets."] },
    );
  }

  const update: Tables["net_worth_items"]["Update"] = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.category !== undefined) {
    update.category = input.category;
    if (input.category === "cash") update.purchase_amount = null;
  }
  if (input.purchaseAmount !== undefined) update.purchase_amount = input.purchaseAmount;
  if (input.archived !== undefined) {
    update.archived_at = input.archived ? new Date().toISOString() : null;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("net_worth_items")
    .update(update)
    .eq("id", itemId)
    .eq("user_id", userId);

  if (error) throw new Error("The net-worth item could not be updated.");
  return true;
}

export async function addNetWorthValuationForUser(
  userId: string,
  itemId: string,
  input: NetWorthValuationInput,
) {
  const item = await queryOwnedItem(userId, itemId);
  if (!item) return null;
  if (item.archived_at) {
    throw new DomainError("Archived items cannot receive new values.", 409);
  }

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
}

export async function updateNetWorthValuationForUser(
  userId: string,
  valuationId: string,
  input: NetWorthValuationInput,
) {
  const supabase = await createClient();
  const { data: existing, error: lookupError } = await supabase
    .from("net_worth_valuations")
    .select("id, item_id")
    .eq("id", valuationId)
    .maybeSingle();

  if (lookupError) throw new Error("Unable to load the valuation.");
  if (!existing) return null;

  const item = await queryOwnedItem(userId, existing.item_id);
  if (!item) return null;

  const { data, error } = await supabase
    .from("net_worth_valuations")
    .update({ value: input.value, valued_on: input.valuedOn })
    .eq("id", valuationId)
    .select(VALUATION_COLUMNS)
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new DomainError("A valuation for this date already exists.", 409);
    }
    throw new Error("The valuation could not be corrected.");
  }

  return toValuation(data);
}

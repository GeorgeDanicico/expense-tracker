import "server-only";

import { getInvestmentsOverviewForUser } from "@/lib/data/investments";
import { buildNetWorthOverview } from "@/lib/net-worth/calculation";
import {
  NET_WORTH_ITEM_KINDS,
  type NetWorthItemKind,
  type NetWorthManualItemSource,
  type NetWorthValuation,
} from "@/lib/net-worth/types";
import { createClient } from "@/lib/supabase/server";

const MAX_ACTIVE_ITEMS = 500;

type NetWorthValuationRow = {
  id: string;
  item_id: string;
  value: number | string;
  valued_on: string;
};

type NetWorthItemRow = {
  id: string;
  name: string;
  kind: string;
  category: string;
  currency: string;
  purchase_amount: number | string | null;
  archived_at: string | null;
  net_worth_valuations: NetWorthValuationRow[] | null;
};

type OwnedNetWorthItemRow = {
  id: string;
  kind: string;
  category: string;
  archived_at: string | null;
};

export type NetWorthItemCreateInput = {
  name: string;
  kind: NetWorthItemKind;
  category: string;
  currency: string;
  purchaseAmount: string | null;
  value: string;
  valuedOn: string;
};

export type NetWorthItemPatchInput = {
  name?: string;
  category?: string;
  purchaseAmount?: string | null;
  archived?: boolean;
};

export type NetWorthValuationInput = {
  value: string;
  valuedOn: string;
};

export class NetWorthMutationError extends Error {
  readonly status: 404 | 409 | 422;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    status: 404 | 409 | 422,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "NetWorthMutationError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

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
    .select(
      "id, name, kind, category, currency, purchase_amount, archived_at, net_worth_valuations(id, item_id, value, valued_on)",
    )
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
    .select("id, kind, category, archived_at")
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Unable to load the net-worth item.");
  return data as unknown as OwnedNetWorthItemRow | null;
}

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
      throw new NetWorthMutationError("The net-worth item could not be created.", 422);
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
    (existing.kind === "liability" || input.category === "cash" || (input.category === undefined && existing.category === "cash"))
    && input.purchaseAmount !== undefined
    && input.purchaseAmount !== null
  ) {
    throw new NetWorthMutationError(
      "Purchase amount is only available for non-cash assets.",
      422,
      { purchaseAmount: ["Purchase amount is only available for non-cash assets."] },
    );
  }

  const update: {
    name?: string;
    category?: string;
    purchase_amount?: string | null;
    archived_at?: string | null;
  } = {};
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
    throw new NetWorthMutationError("Archived items cannot receive new values.", 409);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("net_worth_valuations")
    .upsert(
      { item_id: itemId, value: input.value, valued_on: input.valuedOn },
      { onConflict: "item_id,valued_on" },
    )
    .select("id, item_id, value, valued_on")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new NetWorthMutationError("A valuation for this date already exists.", 409);
    }
    throw new Error("The valuation could not be saved.");
  }

  return toValuation(data as unknown as NetWorthValuationRow);
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
    .select("id, item_id, value, valued_on")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new NetWorthMutationError("A valuation for this date already exists.", 409);
    }
    throw new Error("The valuation could not be corrected.");
  }

  return toValuation(data as unknown as NetWorthValuationRow);
}

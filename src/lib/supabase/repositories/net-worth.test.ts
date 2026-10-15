import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseNetWorthRepository as netWorth } from "@/lib/supabase/repositories/net-worth";

const userId = "10000000-0000-4000-8000-000000000091";
const otherUserId = "10000000-0000-4000-8000-000000000092";
const itemId = "40000000-0000-4000-8000-000000000091";
const valuationId = "50000000-0000-4000-8000-000000000091";

const itemRow = {
  id: itemId,
  user_id: userId,
  name: "Home",
  kind: "asset",
  category: "property",
  currency: "EUR",
  purchase_amount: 180000,
  archived_at: null,
};
const valuationRow = { id: valuationId, item_id: itemId, value: 220000, valued_on: "2026-09-19" };
const valuationInput = { value: "225000", valuedOn: "2026-09-20" };
const duplicateDate = { code: "23505", message: "duplicate key value violates unique constraint" };

function useDatabase(tables: Record<string, Record<string, unknown>[]>, options?: FakeSupabaseOptions) {
  const database = fakeSupabase(tables, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase net-worth repository", () => {
  beforeEach(() => vi.resetAllMocks());

  describe("listActiveItems", () => {
    it("reads only the user's own unarchived items", async () => {
      const { queries } = useDatabase({ net_worth_items: [itemRow] });

      await netWorth.listActiveItems(userId);

      expect(queries[0]).toMatchObject({
        table: "net_worth_items",
        operation: "select",
        filters: [["eq", "user_id", userId], ["is", "archived_at", null]],
        orders: ["category", "name", "net_worth_valuations.valued_on", "net_worth_valuations.id"],
        limits: ["500", "net_worth_valuations:2"],
      });
    });

    it("maps each item with its embedded valuations, newest first", async () => {
      const older = { ...valuationRow, id: "older", value: 200000, valued_on: "2026-08-19" };
      useDatabase({ net_worth_items: [{ ...itemRow, net_worth_valuations: [older, valuationRow] }] });

      expect(await netWorth.listActiveItems(userId)).toEqual([{
        id: itemId,
        name: "Home",
        kind: "asset",
        category: "property",
        currency: "EUR",
        purchaseAmount: "180000",
        archivedAt: null,
        valuations: [
          { id: valuationId, itemId, value: "220000", valuedOn: "2026-09-19" },
          { id: "older", itemId, value: "200000", valuedOn: "2026-08-19" },
        ],
      }]);
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(netWorth.listActiveItems(userId)).rejects.toThrow(new Error("Unable to load net-worth items."));
    });
  });

  describe("getItem", () => {
    it("returns the user's own item", async () => {
      const { queries } = useDatabase({ net_worth_items: [itemRow] });

      expect(await netWorth.getItem(userId, itemId)).toEqual({ id: itemId, kind: "asset", category: "property", archivedAt: null });
      expect(queries[0].filters).toEqual([["eq", "id", itemId], ["eq", "user_id", userId]]);
    });

    it("does not return another user's item", async () => {
      useDatabase({ net_worth_items: [itemRow] });

      expect(await netWorth.getItem(otherUserId, itemId)).toBeNull();
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(netWorth.getItem(userId, itemId)).rejects.toThrow(new Error("Unable to load the net-worth item."));
    });
  });

  describe("createItem", () => {
    const input = {
      name: "Home", kind: "asset", category: "property", currency: "EUR",
      purchaseAmount: "180000", value: "220000", valuedOn: "2026-09-19",
    } as const;

    it("creates the item and its first valuation in one call", async () => {
      const { rpcs } = useDatabase({}, { rpc: () => ({ data: itemId, error: null }) });

      expect(await netWorth.createItem(userId, input)).toEqual({ itemId });
      expect(rpcs).toEqual([{
        fn: "create_net_worth_item_with_valuation",
        args: {
          p_name: "Home", p_kind: "asset", p_category: "property", p_currency: "EUR",
          p_purchase_amount: "180000", p_value: "220000", p_valued_on: "2026-09-19",
        },
      }]);
    });

    it("answers a refused caller with a 422", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { code: "42501", message: "Authentication is required." } }) });

      await expect(netWorth.createItem(userId, input)).rejects.toThrow(
        new DomainError("The net-worth item could not be created.", 422),
      );
    });

    it("hides any other database error behind a generic message", async () => {
      useDatabase({}, { rpc: () => ({ data: null, error: { message: "private database failure" } }) });

      await expect(netWorth.createItem(userId, input)).rejects.toThrow(new Error("The net-worth item could not be created."));
    });
  });

  describe("updateItem", () => {
    it("writes the changes to the user's own item only", async () => {
      const { tables, queries } = useDatabase({ net_worth_items: [itemRow] });

      await netWorth.updateItem(userId, itemId, { name: "Flat", purchaseAmount: null, archivedAt: "2026-10-01T00:00:00Z" });

      expect(queries[0]).toMatchObject({
        operation: "update",
        values: { name: "Flat", purchase_amount: null, archived_at: "2026-10-01T00:00:00Z" },
        filters: [["eq", "id", itemId], ["eq", "user_id", userId]],
      });
      expect(tables.net_worth_items[0]).toMatchObject({ name: "Flat", purchase_amount: null });
    });

    it("leaves another user's item untouched", async () => {
      const { tables } = useDatabase({ net_worth_items: [itemRow] });

      await netWorth.updateItem(otherUserId, itemId, { name: "Flat" });

      expect(tables.net_worth_items[0]).toEqual(itemRow);
    });

    it("hides a database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(netWorth.updateItem(userId, itemId, { name: "Flat" })).rejects.toThrow(
        new Error("The net-worth item could not be updated."),
      );
    });
  });

  describe("saveValuation", () => {
    it("replaces the value already on that date", async () => {
      const { tables, queries } = useDatabase({ net_worth_valuations: [valuationRow] });

      const saved = await netWorth.saveValuation(userId, itemId, { value: "0", valuedOn: "2026-09-19" });

      expect(saved).toEqual({ id: valuationId, itemId, value: "0", valuedOn: "2026-09-19" });
      expect(queries[0]).toMatchObject({ operation: "upsert", onConflict: "item_id,valued_on" });
      expect(tables.net_worth_valuations).toHaveLength(1);
    });

    it("answers a duplicate date with a 409", async () => {
      useDatabase({}, { fail: () => duplicateDate });

      await expect(netWorth.saveValuation(userId, itemId, valuationInput)).rejects.toThrow(
        new DomainError("A valuation for this date already exists.", 409),
      );
    });

    it("hides any other database error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(netWorth.saveValuation(userId, itemId, valuationInput)).rejects.toThrow(
        new Error("The valuation could not be saved."),
      );
    });
  });

  describe("updateValuation", () => {
    const ownedValuation = { ...valuationRow, net_worth_items: { user_id: userId } };

    it("finds the valuation through the user's own item and corrects it", async () => {
      const { queries } = useDatabase({ net_worth_valuations: [ownedValuation] });

      const updated = await netWorth.updateValuation(userId, valuationId, valuationInput);

      expect(updated).toEqual({ id: valuationId, itemId, value: "225000", valuedOn: "2026-09-20" });
      expect(queries[0]).toMatchObject({
        operation: "select",
        filters: [["eq", "id", valuationId], ["eq", "net_worth_items.user_id", userId]],
      });
      expect(queries[1]).toMatchObject({
        operation: "update",
        values: { value: "225000", valued_on: "2026-09-20" },
        filters: [["eq", "id", valuationId], ["eq", "item_id", itemId]],
      });
    });

    it("does not find a valuation on another user's item", async () => {
      const { queries } = useDatabase({ net_worth_valuations: [ownedValuation] });

      expect(await netWorth.updateValuation(otherUserId, valuationId, valuationInput)).toBeNull();
      expect(queries).toHaveLength(1);
    });

    it("hides a lookup error behind a generic message", async () => {
      useDatabase({}, { fail: () => true });

      await expect(netWorth.updateValuation(userId, valuationId, valuationInput)).rejects.toThrow(
        new Error("Unable to load the valuation."),
      );
    });

    it("answers a duplicate date with a 409", async () => {
      useDatabase({ net_worth_valuations: [ownedValuation] }, { fail: (_query, index) => index === 1 && duplicateDate });

      await expect(netWorth.updateValuation(userId, valuationId, valuationInput)).rejects.toThrow(
        new DomainError("A valuation for this date already exists.", 409),
      );
    });

    it("hides any other update error behind a generic message", async () => {
      useDatabase({ net_worth_valuations: [ownedValuation] }, { fail: (_query, index) => index === 1 });

      await expect(netWorth.updateValuation(userId, valuationId, valuationInput)).rejects.toThrow(
        new Error("The valuation could not be corrected."),
      );
    });
  });
});

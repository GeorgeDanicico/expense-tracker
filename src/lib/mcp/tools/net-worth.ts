import { z } from "zod";

import {
  addNetWorthValuationForUser,
  createNetWorthItemForUser,
  getNetWorthOverviewForUser,
  updateNetWorthItemForUser,
  updateNetWorthValuationForUser,
} from "@/lib/data/net-worth";
import { CREATE, defineTool, READ, UPDATE } from "@/lib/mcp/define-tool";
import { netWorthItemPatchSchema, netWorthItemSchema, netWorthValuationSchema } from "@/lib/validation/net-worth";

const updateItemSchema = z.object({ id: z.uuid(), ...netWorthItemPatchSchema.shape });

export const netWorthTools = [
  defineTool({
    name: "get_net_worth",
    title: "Get net worth",
    description: "Net worth with investments and manual assets and liabilities.",
    schema: z.object({}),
    annotations: READ,
    run: (_input, { userId }) => getNetWorthOverviewForUser(userId),
  }),
  defineTool({
    name: "add_net_worth_item",
    title: "Add net worth item",
    description: "Create an asset or liability with its first valuation. Decimals are strings.",
    schema: netWorthItemSchema,
    annotations: CREATE,
    run: (input, { userId }) => createNetWorthItemForUser(userId, { ...input, purchaseAmount: input.purchaseAmount ?? null }),
  }),
  defineTool({
    name: "update_net_worth_item",
    title: "Update net worth item",
    description: "Rename, recategorize, set the purchase amount or archive an item.",
    schema: updateItemSchema,
    annotations: UPDATE,
    notFound: "Net-worth item not found.",
    run: async ({ id, ...patch }, { userId }) =>
      (await updateNetWorthItemForUser(userId, id, netWorthItemPatchSchema.parse(patch))) && { updated: true, id },
  }),
  defineTool({
    name: "add_net_worth_valuation",
    title: "Add net worth valuation",
    description: "Set an item's value on a date, replacing any value already on that date.",
    schema: z.object({ itemId: z.uuid(), ...netWorthValuationSchema.shape }),
    annotations: UPDATE,
    notFound: "Net-worth item not found.",
    run: async ({ itemId, ...input }, { userId }) => {
      const valuation = await addNetWorthValuationForUser(userId, itemId, input);
      return valuation && { valuation };
    },
  }),
  defineTool({
    name: "update_net_worth_valuation",
    title: "Update net worth valuation",
    description: "Correct the value or date of an existing valuation.",
    schema: z.object({ id: z.uuid(), ...netWorthValuationSchema.shape }),
    annotations: UPDATE,
    notFound: "Valuation not found.",
    run: async ({ id, ...input }, { userId }) => {
      const valuation = await updateNetWorthValuationForUser(userId, id, input);
      return valuation && { valuation };
    },
  }),
];

import { z } from "zod";

import {
  createInvestmentTransaction,
  deleteInvestmentTransaction,
  getInvestmentsOverview,
  getInvestmentTransactions,
} from "@/lib/investments/service";
import { CREATE, defineTool, DELETE, READ } from "@/lib/mcp/define-tool";
import { investmentTransactionQuerySchema, investmentTransactionSchema } from "@/lib/validation/investment";
import { idSchema } from "@/lib/validation/primitives";

export const investmentTools = [
  defineTool({
    name: "get_investments",
    title: "Get investments",
    description: "Investment accounts, positions and current valuation.",
    schema: z.object({}),
    annotations: READ,
    module: "investments",
    run: (_input, { userId }) => getInvestmentsOverview(userId),
  }),
  defineTool({
    name: "list_investment_transactions",
    title: "List investment transactions",
    description: "Orders for one instrument and currency in an investment account.",
    schema: investmentTransactionQuerySchema,
    annotations: READ,
    module: "investments",
    notFound: "Investment position not found.",
    run: (input, { userId }) => getInvestmentTransactions(userId, input),
  }),
  defineTool({
    name: "add_investment_transaction",
    title: "Add investment transaction",
    description: "Record a buy or sell order. Decimals are strings; executedAt is an ISO date-time.",
    schema: investmentTransactionSchema,
    annotations: CREATE,
    module: "investments",
    run: (input, { userId }) => createInvestmentTransaction(userId, input),
  }),
  defineTool({
    name: "delete_investment_transaction",
    title: "Delete investment transaction",
    description: "Permanently delete an investment order.",
    schema: z.object({ id: idSchema() }),
    annotations: DELETE,
    module: "investments",
    notFound: "Investment order not found.",
    run: async ({ id }, { userId }) => (await deleteInvestmentTransaction(userId, id)) && { deleted: true, id },
  }),
];

import { z } from "zod";

import {
  createInvestmentTransactionForUser,
  deleteInvestmentTransactionForUser,
  getInvestmentsOverviewForUser,
  getInvestmentTransactionsForUser,
} from "@/lib/data/investments";
import { CREATE, defineTool, DELETE, READ } from "@/lib/mcp/define-tool";
import { investmentTransactionQuerySchema, investmentTransactionSchema } from "@/lib/validation/investment";

export const investmentTools = [
  defineTool({
    name: "get_investments",
    title: "Get investments",
    description: "Investment accounts, positions and current valuation.",
    schema: z.object({}),
    annotations: READ,
    run: (_input, { userId }) => getInvestmentsOverviewForUser(userId),
  }),
  defineTool({
    name: "list_investment_transactions",
    title: "List investment transactions",
    description: "Orders for one instrument and currency in an investment account.",
    schema: investmentTransactionQuerySchema,
    annotations: READ,
    notFound: "Investment position not found.",
    run: (input, { userId }) => getInvestmentTransactionsForUser(userId, input),
  }),
  defineTool({
    name: "add_investment_transaction",
    title: "Add investment transaction",
    description: "Record a buy or sell order. Decimals are strings; executedAt is an ISO date-time.",
    schema: investmentTransactionSchema,
    annotations: CREATE,
    run: (input, { userId }) => createInvestmentTransactionForUser(userId, input),
  }),
  defineTool({
    name: "delete_investment_transaction",
    title: "Delete investment transaction",
    description: "Permanently delete an investment order.",
    schema: z.object({ id: z.uuid() }),
    annotations: DELETE,
    notFound: "Investment order not found.",
    run: async ({ id }, { userId }) => (await deleteInvestmentTransactionForUser(userId, id)) && { deleted: true, id },
  }),
];

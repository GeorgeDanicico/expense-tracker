import { McpServer } from "@modelcontextprotocol/server";

import type { ToolContext } from "@/lib/mcp/define-tool";
import { accountTools } from "@/lib/mcp/tools/account";
import { expenseTabTools } from "@/lib/mcp/tools/expense-tabs";
import { expenseTools } from "@/lib/mcp/tools/expenses";
import { investmentTools } from "@/lib/mcp/tools/investments";
import { netWorthTools } from "@/lib/mcp/tools/net-worth";

const INSTRUCTIONS = [
  "Call get_account first for the currency, today's date and the category and subtype keys.",
  "Expense amounts are in the account currency.",
  "Dates are YYYY-MM-DD in Europe/Bucharest.",
].join(" ");

/** userId comes only from the authenticated session; no tool accepts it as input. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "expense-tracker", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  for (const register of [...accountTools, ...expenseTools, ...expenseTabTools, ...investmentTools, ...netWorthTools]) {
    register(server, ctx);
  }
  return server;
}

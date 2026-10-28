import { McpServer } from "@modelcontextprotocol/server";

import { isFamilyEnabled } from "@/lib/features";
import type { ToolContext } from "@/lib/mcp/define-tool";
import { accountTools } from "@/lib/mcp/tools/account";
import { calendarTools } from "@/lib/mcp/tools/calendar";
import { expenseTabTools } from "@/lib/mcp/tools/expense-tabs";
import { expenseTools } from "@/lib/mcp/tools/expenses";
import { investmentTools } from "@/lib/mcp/tools/investments";
import { netWorthTools } from "@/lib/mcp/tools/net-worth";
import { reminderTools } from "@/lib/mcp/tools/reminders";
import { todoTools } from "@/lib/mcp/tools/todos";

const INSTRUCTIONS = [
  "Call get_account first for the currency, today's date and the category and subtype keys.",
  "Expense amounts are in the account currency.",
  "Dates are YYYY-MM-DD in Europe/Bucharest.",
].join(" ");

/** userId comes only from the authenticated session; no tool accepts it as input. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "expense-tracker", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  // Like the family routes, the to-do and calendar tools don't exist while the family flag is off.
  // Reminders are every user's own and need no family, so their tools are always there.
  const familyTools = isFamilyEnabled() ? [...todoTools, ...calendarTools] : [];
  const tools = [
    ...accountTools, ...expenseTools, ...expenseTabTools, ...investmentTools, ...netWorthTools, ...reminderTools, ...familyTools,
  ];
  for (const register of tools) {
    register(server, ctx);
  }
  return server;
}

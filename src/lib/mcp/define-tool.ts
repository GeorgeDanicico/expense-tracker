import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import { InvestmentMutationError } from "@/lib/data/investments";
import { NetWorthMutationError } from "@/lib/data/net-worth";

export type ToolContext = { userId: string; email: string };
export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

type ToolDefinition<S extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  /** The full schema, re-parsed in the handler so refinements and transforms always apply. */
  schema: S;
  /** The advertised fields, for schemas that are not a plain object (pipes, unions). */
  shape?: z.ZodRawShape;
  annotations: ToolAnnotations;
  /** Message for a null or false result from `run`. */
  notFound?: string;
  run: (input: z.output<S>, ctx: ToolContext) => Promise<unknown>;
};

export const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
export const CREATE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const UPDATE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const DELETE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

function result(data: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, ...(isError && { isError }) };
}

function toolError(error: unknown, name: string): CallToolResult {
  if (error instanceof z.ZodError) {
    const { formErrors, fieldErrors } = z.flattenError(error);
    return result({ error: formErrors[0] ?? "Check the highlighted fields and try again.", fieldErrors }, true);
  }
  if (error instanceof InvestmentMutationError || error instanceof NetWorthMutationError) {
    return result({ error: error.message, fieldErrors: error.fieldErrors }, true);
  }
  // Log only the tool name and error; arguments and credentials stay out of the server log.
  console.error(`MCP tool ${name} failed`, error);
  return result({ error: "The request could not be completed. Try again later." }, true);
}

/** structuredContent must be an object, so arrays and primitives are wrapped. */
function toStructured(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return { items: data };
  return typeof data === "object" && data !== null ? data as Record<string, unknown> : { result: data };
}

export function defineTool<S extends z.ZodType>(tool: ToolDefinition<S>): ToolRegistrar {
  const shape = tool.shape ?? (tool.schema instanceof z.ZodObject ? tool.schema.shape : {});
  return (server, ctx) => {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      // Only the plain fields are advertised; refinements run in the handler so they can report field errors.
      inputSchema: z.object(shape),
      annotations: tool.annotations,
    }, async (args) => {
      try {
        const data = await tool.run(tool.schema.parse(args), ctx);
        if (data === null || data === false || data === undefined) {
          return result({ error: tool.notFound ?? "Not found." }, true);
        }
        return result(toStructured(data));
      } catch (error) {
        return toolError(error, tool.name);
      }
    });
  };
}

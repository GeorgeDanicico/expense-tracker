import type { NextRequest } from "next/server";

import { withPermission } from "@/lib/http/permission";
import { json, notFound, parseBody, parseInput } from "@/lib/http/route";
import { createInvestmentTransaction, getInvestmentTransactions } from "@/lib/investments/service";
import {
  investmentTransactionQuerySchema,
  investmentTransactionSchema,
} from "@/lib/validation/investment";

export const GET = withPermission("investments", "edit", async (request: NextRequest, user) => {
  const query = parseInput({
    accountId: request.nextUrl.searchParams.get("accountId") ?? undefined,
    instrument: request.nextUrl.searchParams.get("instrument") ?? undefined,
    currency: request.nextUrl.searchParams.get("currency") ?? undefined,
  }, investmentTransactionQuerySchema, "Choose a valid investment asset.");

  const transactions = await getInvestmentTransactions(user.id, query)
    ?? notFound("Investment asset not found.");
  return json(transactions);
}, { failure: "Unable to load investment transactions." });

export const POST = withPermission("investments", "edit", async (request: NextRequest, user) => {
  const input = await parseBody(
    request,
    investmentTransactionSchema,
    "Check the highlighted order details and try again.",
  );
  return json(await createInvestmentTransaction(user.id, input), 201);
}, { failure: "The investment order could not be saved." });

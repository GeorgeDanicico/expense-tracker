import type { NextRequest } from "next/server";

import {
  createInvestmentTransactionForUser,
  getInvestmentTransactionsForUser,
} from "@/lib/data/investments";
import { json, notFound, parseBody, parseInput, withUser } from "@/lib/http/route";
import {
  investmentTransactionQuerySchema,
  investmentTransactionSchema,
} from "@/lib/validation/investment";

export const GET = withUser(async (request: NextRequest, user) => {
  const query = parseInput({
    accountId: request.nextUrl.searchParams.get("accountId") ?? undefined,
    instrument: request.nextUrl.searchParams.get("instrument") ?? undefined,
    currency: request.nextUrl.searchParams.get("currency") ?? undefined,
  }, investmentTransactionQuerySchema, "Choose a valid investment asset.");

  const transactions = await getInvestmentTransactionsForUser(user.id, query)
    ?? notFound("Investment asset not found.");
  return json(transactions);
}, { failure: "Unable to load investment transactions." });

export const POST = withUser(async (request: NextRequest, user) => {
  const input = await parseBody(
    request,
    investmentTransactionSchema,
    "Check the highlighted order details and try again.",
  );
  return json(await createInvestmentTransactionForUser(user.id, input), 201);
}, { failure: "The investment order could not be saved." });

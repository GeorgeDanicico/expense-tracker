import type { NextRequest } from "next/server";

import { resolveViewedUserFor } from "@/lib/family/viewed-user";
import { withPermission } from "@/lib/http/permission";
import { json, notFound, parseBody, parseInput } from "@/lib/http/route";
import { createInvestmentTransaction, getInvestmentTransactions } from "@/lib/investments/service";
import {
  investmentTransactionQuerySchema,
  investmentTransactionSchema,
} from "@/lib/validation/investment";

export const GET = withPermission("investments", "edit", async (request: NextRequest, user, _context, member) => {
  const { userId, viewing } = await resolveViewedUserFor(request, user, member);
  const query = parseInput({
    accountId: request.nextUrl.searchParams.get("accountId") ?? undefined,
    instrument: request.nextUrl.searchParams.get("instrument") ?? undefined,
    currency: request.nextUrl.searchParams.get("currency") ?? undefined,
  }, investmentTransactionQuerySchema, "Choose a valid investment asset.");

  const transactions = await getInvestmentTransactions(userId, query)
    ?? notFound("Investment asset not found.");
  return json({ ...transactions, viewing });
}, { failure: "Unable to load investment transactions." });

// Writes never read `?member=`: they always act on the caller.

export const POST = withPermission("investments", "edit", async (request: NextRequest, user) => {
  const input = await parseBody(
    request,
    investmentTransactionSchema,
    "Check the highlighted order details and try again.",
  );
  return json(await createInvestmentTransaction(user.id, input), 201);
}, { failure: "The investment order could not be saved." });

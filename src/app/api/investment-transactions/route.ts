import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getInvestmentTransactionsForUser } from "@/lib/data/investments";
import { investmentTransactionQuerySchema } from "@/lib/validation/investment";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const parsed = investmentTransactionQuerySchema.safeParse({
    accountId: request.nextUrl.searchParams.get("accountId") ?? undefined,
    instrument: request.nextUrl.searchParams.get("instrument") ?? undefined,
    currency: request.nextUrl.searchParams.get("currency") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Choose a valid investment asset.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const transactions = await getInvestmentTransactionsForUser(user.id, parsed.data);
    if (!transactions) {
      return NextResponse.json(
        { error: "Investment asset not found." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(transactions, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Unable to load investment transactions." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

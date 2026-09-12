import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  createInvestmentTransactionForUser,
  getInvestmentTransactionsForUser,
  InvestmentMutationError,
} from "@/lib/data/investments";
import {
  investmentTransactionQuerySchema,
  investmentTransactionSchema,
} from "@/lib/validation/investment";

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

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = investmentTransactionSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the highlighted order details and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const result = await createInvestmentTransactionForUser(user.id, parsed.data);
    return NextResponse.json(result, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof InvestmentMutationError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: error.fieldErrors },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "The investment order could not be saved." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

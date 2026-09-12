import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  deleteInvestmentTransactionForUser,
  InvestmentMutationError,
} from "@/lib/data/investments";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const transactionIdSchema = z.uuid("Order identifier is invalid.");

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const { id } = await context.params;
  const parsed = transactionIdSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid investment order identifier." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const deleted = await deleteInvestmentTransactionForUser(user.id, parsed.data);
    if (!deleted) {
      return NextResponse.json(
        { error: "Investment order not found." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }

    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof InvestmentMutationError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: error.fieldErrors },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "Unable to remove investment order." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

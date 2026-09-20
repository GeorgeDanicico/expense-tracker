import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  NetWorthMutationError,
  updateNetWorthValuationForUser,
} from "@/lib/data/net-worth";
import { netWorthValuationSchema } from "@/lib/validation/net-worth";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const valuationIdSchema = z.uuid("Valuation identifier is invalid.");

export async function PATCH(
  request: NextRequest,
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
  const parsedId = valuationIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "Invalid valuation identifier." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = netWorthValuationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the highlighted valuation and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const valuation = await updateNetWorthValuationForUser(user.id, parsedId.data, parsed.data);
    if (!valuation) {
      return NextResponse.json(
        { error: "Valuation not found." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json({ valuation }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof NetWorthMutationError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: error.fieldErrors },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "The valuation could not be corrected." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

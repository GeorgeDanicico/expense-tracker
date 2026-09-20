import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  createNetWorthItemForUser,
  NetWorthMutationError,
} from "@/lib/data/net-worth";
import { netWorthItemSchema } from "@/lib/validation/net-worth";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = netWorthItemSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the highlighted item details and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const result = await createNetWorthItemForUser(user.id, {
      ...parsed.data,
      purchaseAmount: parsed.data.purchaseAmount ?? null,
    });
    return NextResponse.json(result, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof NetWorthMutationError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: error.fieldErrors },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "The net-worth item could not be saved." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

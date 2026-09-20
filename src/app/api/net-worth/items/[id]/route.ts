import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  NetWorthMutationError,
  updateNetWorthItemForUser,
} from "@/lib/data/net-worth";
import { netWorthItemPatchSchema } from "@/lib/validation/net-worth";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const itemIdSchema = z.uuid("Item identifier is invalid.");

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
  const parsedId = itemIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "Invalid net-worth item identifier." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = netWorthItemPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the highlighted item changes and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const updated = await updateNetWorthItemForUser(user.id, parsedId.data, parsed.data);
    if (!updated) {
      return NextResponse.json(
        { error: "Net-worth item not found." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json({ success: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof NetWorthMutationError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: error.fieldErrors },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "The net-worth item could not be updated." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

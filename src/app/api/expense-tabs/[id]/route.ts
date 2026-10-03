import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { deleteExpenseTabForUser, updateExpenseTabForUser } from "@/lib/data/expense-tabs";
import { expenseTabIdSchema, expenseTabSchema } from "@/lib/validation/expense-tab";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
type TabRouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: TabRouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  const { id } = await context.params;
  if (!expenseTabIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid tab identifier." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const parsed = expenseTabSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the highlighted details and try again.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422, headers: PRIVATE_HEADERS });
  }
  try {
    const tab = await updateExpenseTabForUser(user.id, id, parsed.data);
    if (!tab) return NextResponse.json({ error: "Expense tab not found." }, { status: 404, headers: PRIVATE_HEADERS });
    return NextResponse.json({ tab }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Unable to save expense tab." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function DELETE(_request: Request, context: TabRouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  const { id } = await context.params;
  if (!expenseTabIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid tab identifier." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  try {
    const deleted = await deleteExpenseTabForUser(user.id, id);
    if (!deleted) return NextResponse.json({ error: "Expense tab not found." }, { status: 404, headers: PRIVATE_HEADERS });
    return NextResponse.json({ success: true }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Unable to delete expense tab." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createExpenseTabForUser, getExpenseTabsForUser } from "@/lib/data/expense-tabs";
import { expenseTabSchema } from "@/lib/validation/expense-tab";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  try {
    const tabs = await getExpenseTabsForUser(user.id);
    return NextResponse.json({ tabs }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Unable to load expense tabs." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  const parsed = expenseTabSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the highlighted details and try again.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422, headers: PRIVATE_HEADERS });
  }
  try {
    const tab = await createExpenseTabForUser(user.id, parsed.data);
    return NextResponse.json({ tab }, { status: 201, headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Unable to save expense tab." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

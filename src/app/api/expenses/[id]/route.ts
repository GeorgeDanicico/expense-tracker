import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const expenseIdSchema = z.uuid();

export async function DELETE(_request: Request, context: RouteContext<"/api/expenses/[id]">) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const { id } = await context.params;
  const parsed = expenseIdSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid expense identifier." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", parsed.data)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Unable to delete expense." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }

  return NextResponse.json({ success: true }, { headers: PRIVATE_HEADERS });
}

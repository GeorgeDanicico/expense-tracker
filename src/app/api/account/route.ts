import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getAccountCurrencyForUser } from "@/lib/data/account";
import { createClient } from "@/lib/supabase/server";
import { isSupportedCurrency } from "@/lib/utils/currency";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  try {
    const currency = await getAccountCurrencyForUser(user.id);
    return NextResponse.json({ email: user.email, currency }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Unable to load account settings." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const payload = (await request.json().catch(() => null)) as { currency?: unknown } | null;
  if (!isSupportedCurrency(payload?.currency)) {
    return NextResponse.json(
      { error: "Choose a supported currency." },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email || null,
      currency: payload.currency,
    },
    { onConflict: "id" },
  );

  if (error) {
    return NextResponse.json(
      { error: "The currency could not be saved. Please try again." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }

  return NextResponse.json(
    { email: user.email, currency: payload.currency },
    { headers: PRIVATE_HEADERS },
  );
}

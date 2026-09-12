import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { getInvestmentsOverviewForUser } from "@/lib/data/investments";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const overview = await getInvestmentsOverviewForUser(user.id);
    return NextResponse.json(overview, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Unable to load investments." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

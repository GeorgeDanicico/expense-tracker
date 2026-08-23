"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupportedCurrency } from "@/lib/utils/currency";

export async function updateCurrencyAction(formData: FormData) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const currency = formData.get("currency");
  if (!isSupportedCurrency(currency)) {
    redirect("/settings?status=invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email || null,
      currency,
    },
    { onConflict: "id" },
  );

  if (error) redirect("/settings?status=error");

  revalidatePath("/", "layout");
  redirect("/settings?status=saved");
}

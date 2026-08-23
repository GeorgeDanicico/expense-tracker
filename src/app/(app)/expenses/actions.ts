"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { isValidMonth } from "@/lib/utils/dates";
import { expenseSchema } from "@/lib/validation/expense";

export async function createExpenseAction(
  selectedMonth: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return { status: "error", message: "Your session expired. Sign in again." };

  const parsed = expenseSchema.safeParse({
    description: formData.get("description"),
    amount: formData.get("amount"),
    category: formData.get("category"),
    expenseDate: formData.get("expenseDate"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted details and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  if (!isValidMonth(selectedMonth) || !parsed.data.expenseDate.startsWith(`${selectedMonth}-`)) {
    return {
      status: "error",
      message: "Choose a date inside the selected month.",
      fieldErrors: { expenseDate: ["Date is outside the selected month."] },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
    user_id: user.id,
    description: parsed.data.description,
    amount: parsed.data.amount,
    category: parsed.data.category,
    expense_date: parsed.data.expenseDate,
    notes: parsed.data.notes || null,
  });

  if (error) return { status: "error", message: "The expense could not be saved." };

  revalidatePath("/dashboard");
  revalidatePath("/expenses");
  return { status: "success", message: "Expense saved." };
}

const deleteSchema = z.uuid();

export async function deleteExpenseAction(formData: FormData) {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error("Unauthorized");

  const parsed = deleteSchema.safeParse(formData.get("expenseId"));
  if (!parsed.success) throw new Error("Invalid expense identifier.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", parsed.data)
    .eq("user_id", user.id);

  if (error) throw new Error("Unable to delete expense.");
  revalidatePath("/dashboard");
  revalidatePath("/expenses");
}
